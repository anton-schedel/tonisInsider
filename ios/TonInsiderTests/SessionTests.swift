import Foundation
import Testing
@testable import TonInsider

extension NetworkTests {
    /// The review's findings on who is signed in: the phone and the screen must not disagree.
    @Suite(.serialized) @MainActor
    struct SessionTests {
        private func account(token: String? = "T1") -> (Account, MemoryTokenStore) {
            let tokens = MemoryTokenStore(token)
            let api = API(session: StubProtocol.session(), tokens: tokens)
            return (Account(api: api, defaults: UserDefaults(suiteName: UUID().uuidString)!), tokens)
        }

        @Test func keepsANewerTokenOverAStaleAnswer() async throws {
            let tokens = MemoryTokenStore("T1")
            let api = API(session: StubProtocol.session(), tokens: tokens)
            // While this request (sent with T1) is under way, a logout stores T3; its late answer brings T2.
            StubProtocol.handler = { _ in
                tokens.token = "T3"
                return (response(200, ["X-App-Token": "T2"]), Data(#"{"ok":true}"#.utf8))
            }
            struct Echo: Decodable { let ok: Bool }
            let _: Echo = try await api.get("api/app/my-team/")
            #expect(tokens.token == "T3")
        }

        @Test func logoutOfflineStaysSignedIn() async {
            let (account, tokens) = account()
            account.kickbase = true
            StubProtocol.handler = { _ in throw URLError(.notConnectedToInternet) }
            let message = await account.logOutKickbase()
            #expect(account.kickbase)
            #expect(tokens.token == "T1")
            #expect(message != nil)
        }

        @Test func flagsFollowTheSite() async throws {
            let (account, _) = account()
            account.ligaInsider = true
            account.kickbase = false
            StubProtocol.handler = { _ in (response(200, ["X-App-Session": "kb"]), Data(#"{"total":0,"comments":[]}"#.utf8)) }
            let model = CommentsModel(thread: .liga(key: "1", page: nil), api: account.api)
            await model.load()
            #expect(account.kickbase)
            #expect(!account.ligaInsider)
        }

        @Test func ligaLoginNeedsTheRedirectHome() async {
            let (account, _) = account()
            StubProtocol.handler = { _ in (response(503), Data(#"{"error":"Nicht verfügbar."}"#.utf8)) }
            let message = await account.logInLigaInsider(username: "toni", password: "x")
            #expect(message != nil)
            #expect(!account.ligaInsider)
        }

        @Test func aFailedTeamRefreshKeepsTheTeam() async throws {
            StubProtocol.handler = { _ in (response(200), try fixture("my-team")) }
            let dir = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
            let model = MyTeamModel(api: API(session: StubProtocol.session(), tokens: MemoryTokenStore()), directory: dir)
            await model.load()
            let count = model.team?.players.count
            StubProtocol.handler = { _ in
                (response(200), Data(#"{"error":"Kickbase ist gerade nicht erreichbar.","leagues":[],"started":false,"running":false,"formation":"","lines":[],"bench":[],"players":{}}"#.utf8))
            }
            await model.load()
            #expect(model.team?.players.count == count)
            #expect(model.message == "Kickbase ist gerade nicht erreichbar.")
        }
    }
}
