import Foundation
import Testing
@testable import TonInsider

extension NetworkTests {
    @Suite(.serialized) @MainActor
    struct CommentsTests {
        private func model(_ thread: CommentThread) -> CommentsModel {
            CommentsModel(thread: thread, api: API(session: StubProtocol.session(), tokens: MemoryTokenStore()))
        }

        @Test func decodesALigaThread() async throws {
            StubProtocol.handler = { _ in (response(200), try fixture("liga-thread")) }
            let m = model(.liga(key: "420100", page: nil))
            await m.load()
            #expect(m.total == 3)
            #expect(m.comments.map(\.id) == [11, 13])
            #expect(m.comments[0].voted && m.comments[0].replies.first?.user == "nutzer2")
            #expect(m.comments[1].poll?.options.map(\.pct) == [60, 40])
            #expect(m.comments[1].poll?.mine == nil)
            #expect(m.hasMore)
        }

        @Test func decodesAnOwnThread() async throws {
            StubProtocol.handler = { _ in (response(200), try fixture("own-thread")) }
            let m = model(.own(postId: 900000001))
            await m.load()
            #expect(m.comments.map(\.user) == ["Toni", "Gast"])
            #expect(m.comments[0].voted)
            #expect(m.comments[0].poll?.mine == 1)
            #expect(!m.hasMore)
        }

        @Test func optimisticVoteRollsBackOnError() async throws {
            StubProtocol.handler = { _ in (response(200), try fixture("own-thread")) }
            let m = model(.own(postId: 900000001))
            await m.load()
            StubProtocol.handler = { _ in (response(500), Data(#"{"error":"Kaputt."}"#.utf8)) }
            let task = Task { await m.toggleVote(6) }
            await Task.yield()
            // At once: up and counted.
            #expect(m.comments[1].voted && m.comments[1].score == 1)
            await task.value
            #expect(!m.comments[1].voted && m.comments[1].score == 0)
            #expect(m.message == "Kaputt.")
        }

        @Test func pollPercentagesFromTheServer() async throws {
            // The same thread before this phone voted.
            let fresh = String(decoding: try fixture("own-thread"), as: UTF8.self).replacingOccurrences(of: #", "mine": 1"#, with: "")
            StubProtocol.handler = { _ in (response(200), Data(fresh.utf8)) }
            let m = model(.own(postId: 900000001))
            await m.load()
            StubProtocol.handler = { _ in
                (response(200), Data(#"{"poll":{"question":"Wer gewinnt?","total":11,"options":[{"id":1,"label":"Wir","pct":64},{"id":2,"label":"Die","pct":36}],"mine":2}}"#.utf8))
            }
            await m.votePoll(comment: 5, option: 2)
            #expect(m.comments[0].poll?.options.map(\.pct) == [64, 36])
            #expect(m.comments[0].poll?.mine == 2)
        }
    }
}
