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

        @Test func remembersWhichAnswerHeChoseInALigaPoll() async throws {
            let defaults = UserDefaults(suiteName: UUID().uuidString)!
            let voted = Box(false)
            StubProtocol.handler = { request in
                if request.httpMethod == "POST" { voted.value = true; return (response(200), Data(#"{"ok":true}"#.utf8)) }
                // LigaInsider says only that he voted, not for what.
                let thread = String(decoding: try fixture("liga-thread"), as: UTF8.self)
                return (response(200), Data((voted.value ? thread.replacingOccurrences(of: #""voted": false"#, with: #""voted": true"#) : thread).utf8))
            }
            let m = CommentsModel(thread: .liga(key: "420100", page: nil),
                                  api: API(session: StubProtocol.session(), tokens: MemoryTokenStore()), votes: defaults)
            await m.load()
            await m.votePoll(comment: 13, option: 2)
            let poll = try #require(m.comments.first { $0.id == 13 }?.poll)
            #expect(poll.mine == 2)
            // 20 votes 60/40, one more for B: 12/9 of 21.
            #expect(poll.total == 21 && poll.options.map(\.pct) == [57, 43])
            // Still known when the thread is opened again.
            let again = CommentsModel(thread: .liga(key: "420100", page: nil),
                                      api: API(session: StubProtocol.session(), tokens: MemoryTokenStore()), votes: defaults)
            await again.load()
            #expect(again.comments.first { $0.id == 13 }?.poll?.mine == 2)
        }

        @Test func aReplyFarDownStaysInPlace() async throws {
            StubProtocol.handler = { request in
                let path = request.url!.path()
                if path.hasSuffix("/more/") {
                    return (response(200), Data(#"{"total":3,"comments":[{"id":20,"user":"x","date":"2026-11-03T08:00:00.000Z","text":"Weiter unten","score":0,"vote":0,"replies":[]}]}"#.utf8))
                }
                if request.httpMethod == "POST" { return (response(200), Data(#"{"ok":true,"commentId":99}"#.utf8)) }
                return (response(200), try fixture("liga-thread"))
            }
            let m = model(.liga(key: "420100", page: nil))
            await m.load()
            await m.loadMore()
            #expect(await m.send(text: "Meine Antwort", parent: 20, author: "toni"))
            // The page loaded later is still there, the reply under its comment.
            let far = try #require(m.comments.first { $0.id == 20 })
            #expect(far.replies.map(\.id) == [99])
            #expect(far.replies.first?.user == "toni" && far.replies.first?.text == "Meine Antwort")
            #expect(m.total == 4)
        }

        @Test func anOwnCommentComesBackAsSaved() async throws {
            StubProtocol.handler = { request in
                if request.httpMethod == "POST" {
                    return (response(200), Data(#"{"ok":true,"comment":{"id":7,"user":"Toni","date":"2026-11-03T12:00:00.000Z","text":"Neu","score":0,"voted":false,"replies":[]}}"#.utf8))
                }
                return (response(200), try fixture("own-thread"))
            }
            let m = model(.own(postId: 900000001))
            await m.load()
            #expect(await m.send(text: "Neu", name: "Toni"))
            #expect(m.comments.first?.id == 7)
            #expect(m.comments.count == 3)
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
