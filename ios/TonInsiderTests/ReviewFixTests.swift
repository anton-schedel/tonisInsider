import Foundation
import Testing
@testable import TonInsider

extension NetworkTests {
    /// The second review's findings.
    @Suite(.serialized) @MainActor
    struct ReviewFixTests {
        private func api() -> API { API(session: StubProtocol.session(), tokens: MemoryTokenStore()) }

        @Test func aLateAnswerForTheOldLeagueIsDropped() async throws {
            let team = String(decoding: try fixture("my-team"), as: UTF8.self)
            let leagueA = try JSONDecoder.site.decode(AppTeam.self, from: try fixture("my-team")).leagueId!
            StubProtocol.handler = { request in
                let wanted = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "league" }?.value
                if wanted == "B" { return (response(200), Data(team.replacingOccurrences(of: "\"leagueId\": \"\(leagueA)\"", with: "\"leagueId\": \"B\"").utf8)) }
                Thread.sleep(forTimeInterval: 0.3)   // A answers late
                return (response(200), Data(team.utf8))
            }
            let dir = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
            let model = MyTeamModel(api: api(), directory: dir)
            async let a: Void = model.choose(league: leagueA)
            try await Task.sleep(for: .milliseconds(50))
            await model.choose(league: "B")
            await a
            #expect(model.team?.leagueId == "B")
            #expect(model.leagueId == "B")
        }

        @Test func clearingForgetsTheTeamAndItsCache() async throws {
            StubProtocol.handler = { _ in (response(200), try fixture("my-team")) }
            let dir = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
            let model = MyTeamModel(api: api(), directory: dir)
            await model.load()
            model.clear()
            #expect(model.team == nil)
            let again = MyTeamModel(api: api(), directory: dir)
            again.loadCached()
            #expect(again.team == nil)
        }

        @Test func offlineKeepsTheAccountsScoutList() async {
            let defaults = UserDefaults(suiteName: UUID().uuidString)!
            StubProtocol.handler = { _ in (response(200), Data(#"{"account":true,"ids":[5,6],"added":{}}"#.utf8)) }
            let online = ScoutStore(api: api(), defaults: defaults, signedIn: { true })
            await online.load()
            StubProtocol.handler = { _ in throw URLError(.notConnectedToInternet) }
            let offline = ScoutStore(api: api(), defaults: defaults, signedIn: { true })
            #expect(offline.state.ids == [5, 6])
            await offline.load()
            #expect(offline.state.ids == [5, 6] && offline.state.account)
        }

        @Test func theStarMovesAtOnceAndComesBackOnFailure() async {
            StubProtocol.handler = { _ in Thread.sleep(forTimeInterval: 0.2); return (response(500), Data()) }
            let store = ScoutStore(api: api(), defaults: UserDefaults(suiteName: UUID().uuidString)!, signedIn: { true })
            let task = Task { await store.set(9, on: true) }
            await Task.yield()
            #expect(store.contains(9))
            await task.value
            #expect(!store.contains(9))
            #expect(store.message != nil)
        }

        @Test func scheduledPostsStayOutOfCardsAndTheBadge() throws {
            var feed = try AppFeed.decode(try fixture("app-feed"))
            // Kimmich's news moved into the future.
            if let i = feed.articles.firstIndex(where: { $0.id == 420050 }) { feed.articles[i].publishedAt = .now.addingTimeInterval(3600) }
            #expect(feed.newsOf(player: 3, now: .now).isEmpty)
            let state = ScoutState(ids: [3], added: [:], seenAt: .distantPast, account: false)
            #expect(state.unseen(in: feed, now: .now).isEmpty)
        }

        @Test func aFailedCommentLoadSaysSo() async {
            StubProtocol.handler = { _ in throw URLError(.notConnectedToInternet) }
            let m = CommentsModel(thread: .own(postId: 900000001), api: api())
            await m.load()
            #expect(m.loadFailed)
        }

        @Test func aSecondTapWhileVotingIsIgnored() async throws {
            let calls = Box(0)
            StubProtocol.handler = { request in
                if request.httpMethod == "POST" { calls.value += 1; Thread.sleep(forTimeInterval: 0.2); return (response(200), Data(#"{"score":1,"voted":true}"#.utf8)) }
                return (response(200), try fixture("own-thread"))
            }
            let m = CommentsModel(thread: .own(postId: 900000001), api: api())
            await m.load()
            async let first: Void = m.toggleVote(6)
            await Task.yield()
            await m.toggleVote(6)
            await first
            #expect(calls.value == 1)
            #expect(m.comments[1].voted)
        }
    }
}
