import Foundation
import Testing
@testable import TonInsider

extension NetworkTests {
    @Suite(.serialized) @MainActor
    struct CommentsParityTests {
        private func model(_ thread: CommentThread) -> CommentsModel {
            CommentsModel(thread: thread, api: API(session: StubProtocol.session(), tokens: MemoryTokenStore()))
        }

        @Test func aCommentWithoutADateStillShowsTheThread() async throws {
            // LigaInsider's date is missing now and then: the site sends "" (src/lib/comments.ts parseOne).
            StubProtocol.handler = { _ in
                (response(200), Data(#"""
                {"total":3,"comments":[
                  {"id":1,"user":"a","date":"","text":"Ohne Zeit","score":0,"vote":0,"replies":[
                    {"id":2,"user":"b","date":"","text":"Antwort ohne Zeit","score":0,"vote":0,"replies":[]}]},
                  {"id":3,"user":"c","date":"2026-11-03T10:00:00.000Z","text":"Mit Zeit","score":0,"vote":0,"replies":[]}]}
                """#.utf8))
            }
            let m = model(.liga(key: "420100", page: nil))
            await m.load()
            #expect(m.loaded && !m.loadFailed)
            #expect(m.comments.map(\.id) == [1, 3])
            #expect(m.comments.first?.replies.map(\.id) == [2])
            // Shown without a time.
            #expect(m.comments[0].date == nil && m.comments[0].replies[0].date == nil)
            #expect(m.comments[1].date != nil)
        }

        /// A request's JSON body, as the stub sees it (URLSession hands it over as a stream).
        private nonisolated static func body(_ request: URLRequest) -> [String: Any] {
            guard let stream = request.httpBodyStream else { return [:] }
            stream.open(); defer { stream.close() }
            var data = Data(); var buffer = [UInt8](repeating: 0, count: 4096)
            while stream.hasBytesAvailable { let n = stream.read(&buffer, maxLength: 4096); if n <= 0 { break }; data.append(buffer, count: n) }
            return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        }

        private nonisolated static let nested = #"""
        {"total":3,"comments":[
          {"id":1,"user":"a","date":"2026-11-03T10:00:00.000Z","text":"Oben","score":0,"vote":0,"replies":[
            {"id":2,"user":"b","date":"2026-11-03T10:01:00.000Z","text":"Antwort","score":0,"vote":0,"replies":[
              {"id":3,"user":"c","date":"2026-11-03T10:02:00.000Z","text":"Antwort auf die Antwort","score":2,"vote":0,"replies":[]}]}]}]}
        """#

        @Test func anAnswerToAnAnswerGoesUnderItWithItsConversation() async throws {
            let sent = Box<[String: Any]>([:])
            StubProtocol.handler = { request in
                if request.httpMethod == "POST" {
                    sent.value = Self.body(request)
                    return (response(200), Data(#"{"ok":true,"commentId":"99"}"#.utf8))
                }
                return (response(200), Data(Self.nested.utf8))
            }
            let m = model(.liga(key: "420100", page: nil))
            await m.load()
            #expect(await m.send(text: "Noch eine", parent: 2, author: "toni"))
            // Sent as an answer to the answer, with the conversation's top comment (Comments.astro: root).
            #expect(sent.value["kind"] as? String == "reply")
            #expect(sent.value["commentId"] as? Int == 2 && sent.value["root"] as? Int == 1)
            #expect(m.comments[0].replies[0].replies.map(\.id) == [3, 99])
            #expect(m.total == 4)
        }

        @Test func aVoteReachesAnAnswerToAnAnswer() async throws {
            StubProtocol.handler = { request in
                request.httpMethod == "POST" ? (response(200), Data(#"{"ok":true}"#.utf8)) : (response(200), Data(Self.nested.utf8))
            }
            let m = model(.liga(key: "420100", page: nil))
            await m.load()
            await m.toggleVote(3)
            let deep = m.comments[0].replies[0].replies[0]
            #expect(deep.voted && deep.score == 3)
        }

        @Test func aSentCommentShowsAtOnceAndThenAsSent() async throws {
            StubProtocol.handler = { request in
                if request.httpMethod == "POST" { return (response(200), Data(#"{"ok":true,"commentId":"99"}"#.utf8)) }
                return (response(200), try fixture("liga-thread"))
            }
            let m = model(.liga(key: "420100", page: nil))
            await m.load()
            let task = Task { await m.send(text: "Meine Meinung", author: "toni") }
            await Task.yield()
            // At once: on top, greyed, not yet counted, nothing to vote for.
            let draft = try #require(m.comments.first)
            #expect(draft.pending && !draft.isSent && draft.text == "Meine Meinung" && draft.user == "toni")
            #expect(m.total == 3)
            #expect(await task.value)
            let sent = try #require(m.comments.first)
            #expect(!sent.pending && sent.isSent && sent.id == 99)
            // The same row: it only fades to full.
            #expect(sent.key == draft.key)
            #expect(m.total == 4 && m.comments.count == 3)
        }

        @Test func aFailedCommentGoesAwayAgain() async throws {
            StubProtocol.handler = { request in
                if request.httpMethod == "POST" { return (response(400), Data(#"{"error":"Zu lang."}"#.utf8)) }
                return (response(200), try fixture("liga-thread"))
            }
            let m = model(.liga(key: "420100", page: nil))
            await m.load()
            let task = Task { await m.send(text: "Antwort", parent: 11, author: "toni") }
            await Task.yield()
            #expect(m.comments[0].replies.last?.pending == true)
            // False: the text goes back into its field, with the site's message.
            #expect(await task.value == false)
            #expect(m.comments[0].replies.map(\.id) == [12])
            #expect(m.message == "Zu lang." && m.total == 3)
        }

        @Test func aNewLigaPollKeepsTheBatchesLoaded() async throws {
            let posted = Box(false)
            StubProtocol.handler = { request in
                let path = request.url!.path()
                if path.hasSuffix("/more/") {
                    return (response(200), Data(#"{"total":3,"comments":[{"id":20,"user":"x","date":"2026-11-03T08:00:00.000Z","text":"Weiter unten","score":0,"vote":0,"replies":[]}]}"#.utf8))
                }
                if request.httpMethod == "POST" { posted.value = true; return (response(200), Data(#"{"ok":true,"commentId":"50"}"#.utf8)) }
                guard posted.value else { return (response(200), try fixture("liga-thread")) }
                // The thread's newest comments now start with the poll, with what a vote needs.
                return (response(200), Data(#"""
                {"total":4,"more":{"offset":10,"goffset":0,"moffset":0,"cursor":5},"comments":[
                  {"id":50,"user":"toni","date":"2026-11-03T12:00:00.000Z","text":"Wer trifft?","score":0,"vote":0,"replies":[],
                   "poll":{"question":"Wer trifft?","total":0,"voted":false,"votingId":88,"options":[{"label":"Kane","pct":0,"id":5},{"label":"Olise","pct":0,"id":6}]}}]}
                """#.utf8))
            }
            let m = model(.liga(key: "420100", page: nil))
            await m.load()
            await m.loadMore()
            #expect(await m.send(text: "Wer trifft?", poll: ("Wer trifft?", ["Kane", "Olise"]), author: "toni"))
            // Everything loaded is still there, the poll on top and ready to be voted in.
            #expect(m.comments.map(\.id) == [50, 11, 13, 20])
            #expect(m.comments[0].poll?.votingId == 88 && m.comments[0].poll?.options.map(\.id) == [5, 6])
            #expect(m.comments[0].poll?.hasVoted == false && !m.comments[0].pending)
            #expect(m.total == 4)
        }

        @Test func theMoreButtonSaysWhatIsLeft() async throws {
            StubProtocol.handler = { _ in
                (response(200), Data(String(decoding: try fixture("liga-thread"), as: UTF8.self).replacingOccurrences(of: #""total": 3"#, with: #""total": 40"#).utf8))
            }
            let m = model(.liga(key: "420100", page: "https://www.ligainsider.de/x/"))
            await m.load()
            // Three are on the screen (two comments, one answer).
            #expect(m.moreLabel == "Weitere Kommentare laden (37)")
            #expect(m.originalLabel == nil)
        }

        @Test func withoutANextBatchTheRestIsALink() async throws {
            StubProtocol.handler = { _ in
                (response(200), Data(#"{"total":25,"comments":[{"id":1,"user":"a","date":"","text":"x","score":0,"vote":0,"replies":[]}]}"#.utf8))
            }
            let m = model(.liga(key: "420100", page: "https://www.ligainsider.de/x/"))
            await m.load()
            #expect(!m.hasMore)
            #expect(m.originalLabel == "Alle 25 Kommentare auf ligainsider.de ↗")
            #expect(m.original?.absoluteString == "https://www.ligainsider.de/x/")
        }

        @Test func aThreadThatFailsIsTriedOnceMoreQuietly() async throws {
            let asked = Box(0)
            StubProtocol.handler = { _ in
                asked.value += 1
                if asked.value == 1 { return (response(502), Data()) }
                return (response(200, ["x-stale": "1"]), try fixture("liga-thread"))
            }
            let m = CommentsModel(thread: .liga(key: "420100", page: "https://www.ligainsider.de/x/"),
                                  api: API(session: StubProtocol.session(), tokens: MemoryTokenStore()), retryAfter: .milliseconds(1))
            await m.load()
            #expect(asked.value == 2 && !m.loadFailed && m.comments.count == 2)
            // The site's last copy: said above the thread.
            #expect(m.stale)
            // Twice no answer: the thread is not reachable, the original is a link.
            StubProtocol.handler = { _ in (response(502), Data()) }
            let down = CommentsModel(thread: .liga(key: "420100", page: "https://www.ligainsider.de/x/"),
                                     api: API(session: StubProtocol.session(), tokens: MemoryTokenStore()), retryAfter: .milliseconds(1))
            await down.load()
            #expect(down.loaded && down.loadFailed)
            #expect(down.originalLabel == "Alle Kommentare auf ligainsider.de ↗")
        }

        @Test func fieldsAreCutAtTheSitesLengths() {
            #expect(CommentLimits.liga.text == 2000 && CommentLimits.own.text == 1000)
            #expect(CommentLimits.liga.question == 200 && CommentLimits.liga.answer == 80 && CommentLimits.own.name == 30)
            #expect(String(repeating: "a", count: 2100).limited(to: 2000).count == 2000)
            #expect("kurz".limited(to: 30) == "kurz")
            // Counted as the browser counts (an emoji is two), and never cut through.
            #expect("ab⚽️😀".limited(to: 5) == "ab⚽️")
        }

        @Test func aCancelledLoadIsNotAFailure() async throws {
            StubProtocol.handler = { _ in throw URLError(.cancelled) }
            let m = model(.liga(key: "420100", page: nil))
            await m.load()
            // Not loaded yet: the page loads it again when it comes back.
            #expect(!m.loaded && !m.loadFailed)
            StubProtocol.handler = { _ in (response(200), try fixture("liga-thread")) }
            await m.load()
            #expect(m.loaded && m.comments.count == 2)
        }

        @Test func aCancelledVoteSaysNothing() async throws {
            StubProtocol.handler = { _ in (response(200), try fixture("own-thread")) }
            let m = model(.own(postId: 900000001))
            await m.load()
            StubProtocol.handler = { _ in throw URLError(.cancelled) }
            await m.toggleVote(6)
            #expect(m.message == nil)
            #expect(m.comments[1].voted == false && m.comments[1].score == 0)
        }

        @Test func aRepeatedPollVoteShowsThePollAsItStands() async throws {
            // The thread as this phone last saw it: not voted (the vote was cast elsewhere, or the answer got lost).
            let fresh = String(decoding: try fixture("own-thread"), as: UTF8.self).replacingOccurrences(of: #", "mine": 1"#, with: "")
            StubProtocol.handler = { _ in (response(200), Data(fresh.utf8)) }
            let m = model(.own(postId: 900000001))
            await m.load()
            StubProtocol.handler = { _ in
                (response(409), Data(#"{"poll":{"question":"Wer gewinnt?","total":10,"options":[{"id":1,"label":"Wir","pct":70},{"id":2,"label":"Die","pct":30}],"mine":1}}"#.utf8))
            }
            await m.votePoll(comment: 5, option: 2)
            #expect(m.message == nil)
            #expect(m.comments[0].poll?.mine == 1)
            #expect(m.comments[0].poll?.hasVoted == true)
        }

        @Test func theSameCursorAgainEndsTheThread() async throws {
            StubProtocol.handler = { request in
                if request.url!.path().hasSuffix("/more/") {
                    return (response(200), Data(#"{"total":3,"more":{"offset":10,"goffset":0,"moffset":0,"cursor":5},"comments":[{"id":20,"user":"x","date":"2026-11-03T08:00:00.000Z","text":"Weiter unten","score":0,"vote":0,"replies":[]}]}"#.utf8))
                }
                return (response(200), try fixture("liga-thread"))
            }
            let m = model(.liga(key: "420100", page: nil))
            await m.load()
            await m.loadMore()
            #expect(m.comments.map(\.id) == [11, 13, 20])
            // LigaInsider's cursor didn't move: nothing more to ask for (or the page would ask forever).
            #expect(!m.hasMore)
        }
    }

    @Suite(.serialized)
    struct CancellationTests {
        private struct Echo: Decodable { let ok: Bool }

        @Test func aCancelledRequestIsNotOffline() async throws {
            let api = API(session: StubProtocol.session(), tokens: MemoryTokenStore())
            StubProtocol.handler = { _ in throw URLError(.cancelled) }
            await #expect(throws: CancellationError.self) { let _: Echo = try await api.get("api/scout/") }
            StubProtocol.handler = { _ in throw URLError(.notConnectedToInternet) }
            await #expect(throws: APIError.offline) { let _: Echo = try await api.get("api/scout/") }
        }

        @Test @MainActor func aCancelledTeamLoadShowsNoMessage() async throws {
            StubProtocol.handler = { _ in throw URLError(.cancelled) }
            let dir = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
            let model = MyTeamModel(api: API(session: StubProtocol.session(), tokens: MemoryTokenStore()), directory: dir)
            await model.load()
            #expect(model.message == nil)
        }

        @Test @MainActor func aCancelledChatsLoadIsNotAFailure() async throws {
            StubProtocol.handler = { _ in throw URLError(.cancelled) }
            let model = ChatsModel(api: API(session: StubProtocol.session(), tokens: MemoryTokenStore("T1")), signedIn: { true })
            await model.load()
            #expect(!model.loaded && !model.loadFailed)
        }
    }
}
