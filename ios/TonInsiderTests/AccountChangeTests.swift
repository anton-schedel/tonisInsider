import Foundation
import Testing
@testable import TonInsider

extension NetworkTests {
    /// What must hold when a login comes, goes or runs out, and when answers arrive out of order.
    @Suite(.serialized) @MainActor
    struct AccountChangeTests {
        private func api(_ tokens: MemoryTokenStore = MemoryTokenStore()) -> API { API(session: StubProtocol.session(), tokens: tokens) }
        private func tempDirectory() -> URL { FileManager.default.temporaryDirectory.appending(path: UUID().uuidString) }
        private nonisolated static func list(_ ids: [Int]) -> Data { Data(#"{"account":true,"ids":\#(ids),"added":{}}"#.utf8) }
        private nonisolated static let signedOut = #"{"signedOut":"%@","leagues":[],"started":false,"running":false,"formation":"0-0-0","lines":[],"bench":[],"players":{}}"#
        private nonisolated static func prompt(_ why: String) -> Data { Data(signedOut.replacingOccurrences(of: "%@", with: why).utf8) }

        // MARK: the scout list

        private func scoutStore(signedIn: Box<Bool> = Box(true)) -> ScoutStore {
            ScoutStore(api: api(), defaults: UserDefaults(suiteName: UUID().uuidString)!, signedIn: { signedIn.value })
        }

        @Test func aStarThatCannotBeSavedSaysWhyInTheSitesWords() async {
            StubProtocol.handler = { request in
                request.httpMethod == "POST" ? (response(403), Data(#"{"error":"Nicht erlaubt."}"#.utf8)) : (response(200), Self.list([3]))
            }
            let store = scoutStore()
            await store.load()
            let saved = await store.set(7, on: true)
            #expect(!saved)
            #expect(store.message == "Nicht erlaubt.")
            #expect(store.state.ids == [3])
        }

        @Test func aStarWithoutConnectionSaysSo() async {
            StubProtocol.handler = { _ in (response(200), Self.list([3])) }
            let store = scoutStore()
            await store.load()
            StubProtocol.handler = { _ in throw URLError(.notConnectedToInternet) }
            let saved = await store.set(3, on: false)
            #expect(!saved)
            #expect(store.message == APIError.offline.message)
            #expect(store.state.ids == [3])
        }

        @Test func aFullListSaysSoInsteadOfFlippingBackSilently() async {
            // Past its limit the site leaves the player out and answers with the list as it is.
            StubProtocol.handler = { _ in (response(200), Self.list([3, 4])) }
            let store = scoutStore()
            await store.load()
            let saved = await store.set(7, on: true)
            #expect(!saved)
            #expect(store.message?.contains("voll") == true)
            #expect(store.state.ids == [3, 4])
        }

        @Test func aSavedStarLeavesNoMessage() async {
            StubProtocol.handler = { _ in throw URLError(.notConnectedToInternet) }
            let store = scoutStore()
            await store.set(7, on: true)
            #expect(store.message != nil)
            StubProtocol.handler = { request in (response(200), Self.list(request.httpMethod == "POST" ? [7, 3] : [3])) }
            let saved = await store.set(7, on: true)
            #expect(saved)
            #expect(store.message == nil)
            #expect(store.state.ids == [7, 3])
        }

        @Test func reloadingShowsTheListOfTheAccountThatOwnsItNow() async {
            // LigaInsider only: its list. Then Kickbase is added: the list is the Kickbase account's from then on.
            let owner = Box([3])
            let signedIn = Box(true)
            StubProtocol.handler = { _ in (response(200), Self.list(owner.value)) }
            let store = scoutStore(signedIn: signedIn)
            await store.load()
            #expect(store.state.ids == [3])
            owner.value = [8, 9]
            await store.load()
            #expect(store.state.ids == [8, 9] && store.state.account)
            // Both logins gone: the phone's own list.
            signedIn.value = false
            await store.load()
            #expect(store.state.ids.isEmpty && !store.state.account)
        }

        @Test func aLateAnswerForTheAccountBeforeIsDropped() async throws {
            let calls = Box(0)
            StubProtocol.handler = { _ in
                calls.value += 1
                if calls.value == 1 {
                    Thread.sleep(forTimeInterval: 0.3)   // the list of the account before answers late
                    return (response(200), Self.list([3]))
                }
                return (response(200), Self.list([8, 9]))
            }
            let store = scoutStore()
            async let before: Void = store.load()
            try await Task.sleep(for: .milliseconds(50))
            await store.load()
            await before
            #expect(store.state.ids == [8, 9])
        }

        // MARK: the login flags

        private func account(_ tokens: MemoryTokenStore, teamCache: URL? = nil, kickbase: Bool = false) -> Account {
            let defaults = UserDefaults(suiteName: UUID().uuidString)!
            defaults.set(kickbase, forKey: "kb")
            return Account(api: api(tokens), defaults: defaults, teamCache: teamCache ?? tempDirectory())
        }
        private struct Echo: Decodable { let ok: Bool }

        @Test func anAnswerFromBeforeALogoutDoesNotSignBackIn() async throws {
            let tokens = MemoryTokenStore("T1")
            let account = account(tokens)
            account.kickbase = false
            // Sent with T1 while signed in; the logout stores T2 while it is under way; its answer still says "kb".
            StubProtocol.handler = { _ in
                tokens.token = "T2"
                return (response(200, ["X-App-Session": "kb,li"]), Data(#"{"ok":true}"#.utf8))
            }
            let _: Echo = try await account.api.get("api/app/my-team/")
            #expect(!account.kickbase)
            #expect(!account.ligaInsider)
        }

        @Test func anAnswerFromBeforeALoginDoesNotSignOutOrWipeTheNames() async throws {
            let tokens = MemoryTokenStore(nil)
            let account = account(tokens)
            account.kickbase = true
            account.kickbaseName = "Toni"
            account.ligaInsider = true
            account.ligaInsiderName = "toni"
            // Sent without a token; the login stores T1 while it is under way; its answer says nobody is signed in.
            StubProtocol.handler = { _ in
                tokens.token = "T1"
                return (response(200, ["X-App-Session": ""]), Data(#"{"ok":true}"#.utf8))
            }
            let _: Echo = try await account.api.get("api/scout/")
            #expect(account.kickbase && account.ligaInsider)
            #expect(account.kickbaseName == "Toni" && account.ligaInsiderName == "toni")
        }

        @Test func aLateAnswerWithItsOwnTokenIsNotFollowedEither() async throws {
            let tokens = MemoryTokenStore("T1")
            let account = account(tokens)
            StubProtocol.handler = { _ in
                tokens.token = "T3"
                return (response(200, ["X-App-Token": "T2", "X-App-Session": "kb"]), Data(#"{"ok":true}"#.utf8))
            }
            let _: Echo = try await account.api.get("api/scout/")
            #expect(tokens.token == "T3")
            #expect(!account.kickbase)
        }

        @Test func answersToTheSessionAsItIsAreFollowed() async throws {
            let tokens = MemoryTokenStore("T1")
            let account = account(tokens)
            account.ligaInsider = true
            // One that changes the session (a new token), then one that doesn't.
            StubProtocol.handler = { _ in (response(200, ["X-App-Token": "T2", "X-App-Session": "kb"]), Data(#"{"ok":true}"#.utf8)) }
            let _: Echo = try await account.api.get("api/scout/")
            #expect(account.kickbase && !account.ligaInsider)
            StubProtocol.handler = { _ in (response(200, ["X-App-Session": "li"]), Data(#"{"ok":true}"#.utf8)) }
            let _: Echo = try await account.api.get("api/scout/")
            #expect(!account.kickbase && account.ligaInsider)
        }

        // MARK: Mein Team

        @Test func loggingOutAnywhereForgetsTheStoredTeam() async throws {
            // Mein Team was open once (its team is on the phone); later the logout happens in Einstellungen.
            let dir = tempDirectory()
            StubProtocol.handler = { _ in (response(200), try fixture("my-team")) }
            await MyTeamModel(api: api(), directory: dir).load()
            let tokens = MemoryTokenStore("T1")
            let account = account(tokens, teamCache: dir, kickbase: true)
            #expect(FileManager.default.fileExists(atPath: dir.path()))
            StubProtocol.handler = { _ in (response(303, ["Location": "/", "X-App-Token": "T2", "X-App-Session": ""]), Data()) }
            let problem = await account.logOutKickbase()
            #expect(problem == nil)
            #expect(!account.kickbase)
            // The next account's Mein Team finds nothing of the one before.
            let next = MyTeamModel(api: api(), directory: dir)
            next.loadCached()
            #expect(next.team == nil)
        }

        @Test func aKickbaseLoginForgetsTheStoredTeamToo() async throws {
            let dir = tempDirectory()
            StubProtocol.handler = { _ in (response(200), try fixture("my-team")) }
            await MyTeamModel(api: api(), directory: dir).load()
            let account = account(MemoryTokenStore(), teamCache: dir)
            account.kickbase = true
            let next = MyTeamModel(api: api(), directory: dir)
            next.loadCached()
            #expect(next.team == nil)
            // And a team loaded after that is kept again.
            await next.load()
            let again = MyTeamModel(api: api(), directory: dir)
            again.loadCached()
            #expect(again.team?.players.isEmpty == false)
        }

        @Test func anExpiredSessionKeepsSayingSoUntilTheNextLogin() async throws {
            let model = MyTeamModel(api: api(), directory: tempDirectory())
            StubProtocol.handler = { _ in (response(200), Self.prompt("expired")) }
            await model.load()
            #expect(model.team?.signedOut == "expired")
            // The site cleared the session with that answer: the flag flips, and every later answer says "none".
            StubProtocol.handler = { _ in (response(200), Self.prompt("none")) }
            await model.accountChanged(signedIn: false)
            #expect(model.team?.signedOut == "expired")
            await model.load()
            #expect(model.team?.signedOut == "expired")
            #expect(model.showsLoginPrompt)
            // Signed in again: the team; and a logout after that is an ordinary one.
            StubProtocol.handler = { _ in (response(200), try fixture("my-team")) }
            await model.accountChanged(signedIn: true)
            #expect(model.team?.signedOut == nil && model.team?.players.isEmpty == false)
            StubProtocol.handler = { _ in (response(200), Self.prompt("none")) }
            await model.accountChanged(signedIn: false)
            #expect(model.team?.signedOut == "none")
        }

        @Test func anExpiredAnswerOvertakenByTheLogoutItCausesStillCounts() async throws {
            let calls = Box(0)
            StubProtocol.handler = { _ in
                calls.value += 1
                if calls.value == 1 {
                    Thread.sleep(forTimeInterval: 0.3)
                    return (response(200), Self.prompt("expired"))
                }
                return (response(200), Self.prompt("none"))
            }
            let model = MyTeamModel(api: api(), directory: tempDirectory())
            async let first: Void = model.load()
            try await Task.sleep(for: .milliseconds(50))
            await model.accountChanged(signedIn: false)
            await first
            #expect(model.team?.signedOut == "expired")
        }

        // MARK: the card's points

        private let points = #"{"live":{"state":1,"points":136,"minute":71},"lines":[{"name":"Parade","count":4,"points":48}]}"#

        @Test func aPressAndTheTapThatFollowsAskOnce() async throws {
            let calls = Box(0)
            let body = points
            StubProtocol.handler = { _ in calls.value += 1; Thread.sleep(forTimeInterval: 0.1); return (response(200), Data(body.utf8)) }
            let breakdown = PointsBreakdown(api: api())
            #expect(breakdown.fresh("1873") == nil)
            breakdown.warm("1873")
            breakdown.warm("1873")
            async let a = breakdown.load("1873")
            async let b = breakdown.load("1873")
            _ = try await (a, b)
            #expect(calls.value == 1)
            // Loaded: a card opened now shows it at once.
            #expect(breakdown.fresh("1873")?.lines.first?.name == "Parade")
            #expect(breakdown.fresh("1873", now: .now.addingTimeInterval(31)) == nil)
        }
    }
}
