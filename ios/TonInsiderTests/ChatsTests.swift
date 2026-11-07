import Foundation
import Testing
@testable import TonInsider

/// One row as /api/chats/ sends it (src/lib/chatsApi.ts ChatView).
private func chatJSON(_ id: Int, link: String = "/artikel/420300/#c77", status: String = "ok", news: Bool = false, line: String = "▲ 3 · keine Antworten") -> String {
    #"""
    {"id":\#(id),"place":{"title":"Wirtz zurück im Training","href":"/artikel/420300/","club":{"name":"Leverkusen","slug":"bayer-leverkusen","crest":"/img/b04.png"}},
     "link":"\#(link)","started":true,"kind":"comment","activityAt":"2026-11-06T12:00:00.000Z","status":"\#(status)",
     \#(news ? #""news":{"answers":1,"votes":0,"poll":0},"# : "")"lines":{"mine":"Du: Der startet sicher","status":"\#(line)"},"checked":true}
    """#
}
private func listJSON(_ chats: String...) -> Data { Data(#"{"signedIn":true,"chats":[\#(chats.joined(separator: ","))]}"#.utf8) }

extension NetworkTests {
    @Suite(.serialized) @MainActor
    struct ChatsTests {
        private func model(signedIn: Bool = true) -> ChatsModel {
            ChatsModel(api: API(session: StubProtocol.session(), tokens: MemoryTokenStore("T1")), signedIn: { signedIn })
        }

        @Test func decodesTheListAndCountsChatsWithNews() async throws {
            StubProtocol.handler = { _ in (response(200), listJSON(chatJSON(1, news: true), chatJSON(2), chatJSON(3, link: "/vereine/bayer-leverkusen/#c5", status: "over", news: true))) }
            let m = model()
            await m.load()
            #expect(m.signedIn)
            #expect(m.chats.map(\.id) == [1, 2, 3])
            #expect(m.chats[0].place.club?.slug == "bayer-leverkusen")
            #expect(m.chats[0].lines.mine == "Du: Der startet sicher")
            // Only chats that can be opened count, each once.
            #expect(m.badge == 1)
        }

        @Test func refreshKeepsTheOrderAndFollowsTheThreadsBatches() async throws {
            let asked = Box<[String]>([])
            StubProtocol.handler = { request in
                let url = request.url!
                asked.value.append(url.path() + (url.query.map { "?\($0)" } ?? ""))
                switch url.path() {
                case "/api/chats/": return (response(200), listJSON(chatJSON(1), chatJSON(2)))
                case "/api/chats/1/":
                    if url.query == nil { return (response(200), Data(#"{"next":{"offset":10,"goffset":0,"moffset":0,"cursor":5}}"#.utf8)) }
                    return (response(200), Data(#"{"chat":\#(chatJSON(1, news: true, line: "Kalle: „Ja“"))}"#.utf8))
                default: return (response(200), Data(#"{"chat":\#(chatJSON(2, line: "▲ 4 · 1 Antwort"))}"#.utf8))
                }
            }
            let m = model()
            await m.load()
            await m.refreshAll()
            #expect(m.chats.map(\.id) == [1, 2])
            #expect(m.chats.map(\.lines.status) == ["Kalle: „Ja“", "▲ 4 · 1 Antwort"])
            #expect(asked.value.contains { $0.hasPrefix("/api/chats/1/?") && $0.contains("cursor=5") && $0.contains("offset=10") && $0.contains("n=1") })
        }

        @Test func looksForNewsAtMostEveryThreeMinutes() async throws {
            let calls = Box(0)
            StubProtocol.handler = { _ in calls.value += 1; return (response(200), listJSON()) }
            let m = model()
            let start = Date(timeIntervalSince1970: 1_000_000)
            await m.check(now: start)
            let after = calls.value
            #expect(after > 0)
            await m.check(now: start.addingTimeInterval(120))
            #expect(calls.value == after)
            await m.check(now: start.addingTimeInterval(181))
            #expect(calls.value > after)
        }

        @Test func signedOutOfLigaInsiderNothingIsAsked() async throws {
            let calls = Box(0)
            StubProtocol.handler = { _ in calls.value += 1; return (response(200), listJSON(chatJSON(1, news: true))) }
            let m = model(signedIn: false)
            await m.check(now: .now)
            #expect(calls.value == 0)
            #expect(m.chats.isEmpty && m.badge == 0)
        }

        @Test func openingAChatMarksItSeen() async throws {
            let posted = Box<String?>(nil)
            StubProtocol.handler = { request in
                if request.httpMethod == "POST" { posted.value = request.url!.path(); return (response(200), Data(#"{"ok":true}"#.utf8)) }
                return (response(200), listJSON(chatJSON(1, news: true)))
            }
            let m = model()
            await m.load()
            #expect(m.badge == 1)
            await m.open(1)
            #expect(posted.value == "/api/chats/1/seen/")
            #expect(m.badge == 0)
        }

        @Test func markingAllReadClearsEveryChatAndTellsTheSite() async throws {
            let posted = Box<[String]>([])
            let seen = Box(false)
            StubProtocol.handler = { request in
                if request.httpMethod == "POST" { posted.value.append(request.url!.path()); seen.value = true; return (response(200), Data(#"{"ok":true}"#.utf8)) }
                // After "Alle gelesen" the site sends the rows with their summaries and no news.
                return (response(200), seen.value ? listJSON(chatJSON(1), chatJSON(2)) : listJSON(chatJSON(1, news: true), chatJSON(2, news: true)))
            }
            let m = model()
            await m.load()
            #expect(m.badge == 2)
            await m.markAllSeen()
            #expect(posted.value == ["/api/chats/seen/"])
            #expect(m.badge == 0)
            #expect(m.chats.map(\.id) == [1, 2])
            #expect(m.chats[0].lines.status == "▲ 3 · keine Antworten")
        }

        @Test func aChatLeadsToItsArticleOrLineupPage() {
            #expect(ChatTarget(link: "/artikel/420300/#c77") == .article(id: 420300, comment: 77))
            #expect(ChatTarget(link: "/vereine/bayer-leverkusen/#c5") == .club(slug: "bayer-leverkusen", comment: 5))
            #expect(ChatTarget(link: "/#c5") == nil)
            #expect(ChatTarget(link: "/artikel/420300/") == nil)
            // The route carries the chat, so the page marks it seen when it opens.
            #expect(ChatTarget(link: "/artikel/420300/#c77")?.articleRoute(chat: 3) == ArticleRoute(id: 420300, comment: 77, chat: 3))
            #expect(ChatTarget(link: "/vereine/bayer-leverkusen/#c5")?.clubRoute(chat: 4) == ClubRoute(slug: "bayer-leverkusen", comment: 5, chat: 4))
            #expect(ChatTarget(link: "/vereine/bayer-leverkusen/#c5")?.articleRoute(chat: 4) == nil)
        }

        @Test func whileTheListIsOpenRowsKeepTheirPlace() async throws {
            let order = Box([1, 2])
            StubProtocol.handler = { _ in (response(200), listJSON(order.value.map { chatJSON($0, line: "jetzt \($0)") }.joined(separator: ","))) }
            let m = model()
            await m.load()
            m.isOpen = true
            order.value = [2, 1, 3]
            await m.load()
            #expect(m.chats.map(\.id) == [1, 2, 3])
            #expect(m.chats[0].lines.status == "jetzt 1")
            m.isOpen = false
            await m.load()
            #expect(m.chats.map(\.id) == [2, 1, 3])
        }

        @Test func theConversationIsShownOnlyTheFirstTime() async throws {
            StubProtocol.handler = { _ in (response(200), try fixture("liga-thread")) }
            let m = CommentsModel(thread: .liga(key: "420100", page: nil), api: API(session: StubProtocol.session(), tokens: MemoryTokenStore()))
            await m.load()
            #expect(await m.takeFocus(13))
            #expect(await m.takeFocus(13) == false)
        }

        @Test func revealLoadsBatchesUntilTheConversationIsThere() async throws {
            let calls = Box(0)
            StubProtocol.handler = { request in
                calls.value += 1
                if request.url!.path().hasSuffix("/more/") {
                    // Each further batch: one comment (21, 22, …) and another cursor.
                    let id = 20 + calls.value - 1
                    return (response(200), Data(#"{"total":99,"more":{"offset":\#(id),"goffset":0,"moffset":0,"cursor":\#(id)},"comments":[{"id":\#(id),"user":"x","date":"2026-11-03T10:00:00.000Z","text":"t","score":0,"vote":0,"replies":[]}]}"#.utf8))
                }
                return (response(200), try fixture("liga-thread"))
            }
            let m = CommentsModel(thread: .liga(key: "420100", page: nil), api: API(session: StubProtocol.session(), tokens: MemoryTokenStore()))
            await m.load()
            #expect(await m.reveal(13))
            #expect(calls.value == 1)
            #expect(await m.reveal(22))
            #expect(calls.value == 3)
            // Not there after 12 more batches: it stops.
            #expect(await m.reveal(999) == false)
            #expect(calls.value == 15)
        }
    }
}
