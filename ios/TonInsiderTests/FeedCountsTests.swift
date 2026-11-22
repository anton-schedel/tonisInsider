import Foundation
import Testing
@testable import TonInsider

extension NetworkTests {
    /// The live comment counts on the feed's rows, and where an article's club and source lead.
    @Suite(.serialized) @MainActor
    struct FeedCountsTests {
        private func store() -> FeedStore {
            FeedStore(session: StubProtocol.session(), directory: FileManager.default.temporaryDirectory.appending(path: UUID().uuidString))
        }

        @Test func liveCountsGoOverTheFeeds() async throws {
            let asked = Box<URL?>(nil)
            StubProtocol.handler = { request in
                guard request.url!.path().hasSuffix("comment-counts/") else { return (response(200, ["ETag": "\"a\""]), try fixture("app-feed")) }
                asked.value = request.url
                return (response(200), Data(#"{"420100":31,"900000002":4}"#.utf8))
            }
            let store = store()
            await store.refresh()
            // The feed's own count of its last build, replaced; our own post has one at all only from here.
            #expect(store.feed?.commentCounts["420100"] == 31)
            #expect(store.feed?.commentCounts["900000002"] == 4)
            // Our own posts are asked for by id (ArticleRow.astro: ?own=…), LigaInsider's articles aren't.
            let own = URLComponents(url: try #require(asked.value), resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "own" }?.value
            #expect(Set((own ?? "").split(separator: ",")) == ["900000003", "900000002"])
        }

        @Test func theLastCountsStayWhileALookFails() async throws {
            let counts = Box<String?>(#"{"420100":31}"#)
            let etag = Box("\"a\"")
            StubProtocol.handler = { request in
                guard request.url!.path().hasSuffix("comment-counts/") else {
                    if request.value(forHTTPHeaderField: "If-None-Match") == etag.value { return (response(304), Data()) }
                    return (response(200, ["ETag": etag.value]), try fixture("app-feed"))
                }
                guard let body = counts.value else { return (response(502), Data(#"{"error":"LigaInsider ist gerade nicht erreichbar."}"#.utf8)) }
                return (response(200), Data(body.utf8))
            }
            let store = store()
            await store.refresh()
            #expect(store.feed?.commentCounts["420100"] == 31)
            // No answer for the counts, and a newer build of the feed (with its older count) comes in.
            counts.value = nil
            etag.value = "\"b\""
            await store.refresh()
            #expect(store.feed?.commentCounts["420100"] == 31)
            #expect(store.lastError == nil)
        }

        @Test func theClubNameLeadsToItsLineupWhenThereIsOne() throws {
            let feed = try AppFeed.decode(try fixture("app-feed"))
            let article = try #require(feed.articles.first { $0.id == 420100 })
            #expect(article.clubLineupSlug(in: feed) == "fc-bayern-muenchen")
            // No lineup for that club (a national team): plain text.
            var other = article
            other.club?.slug = "deutschland"
            #expect(other.clubLineupSlug(in: feed) == nil)
            // Our own posts have no club page.
            var own = article
            own.own = true
            #expect(own.clubLineupSlug(in: feed) == nil)
            #expect(article.clubLineupSlug(in: nil) == nil)
        }

        @Test func theSourceIsALinkWhenItHasAnAddress() throws {
            let feed = try AppFeed.decode(try fixture("app-feed"))
            var article = try #require(feed.articles.first { $0.id == 420100 })
            article.author = "Redaktion"
            article.source = .init(name: "kicker", url: "https://www.kicker.de/x")
            let linked = article.byline
            #expect(String(linked.characters).hasSuffix("Uhr · Redaktion · Quelle: kicker"))
            let links = linked.runs.compactMap { run in run.link.map { ($0, String(linked[run.range].characters)) } }
            #expect(links.count == 1 && links.first?.0.absoluteString == "https://www.kicker.de/x" && links.first?.1 == "kicker")
            // Without an address (or with something that isn't one): plain text.
            article.source = .init(name: "kicker", url: nil)
            #expect(article.byline.runs.allSatisfy { $0.link == nil })
            article.source = .init(name: "kicker", url: "javascript:alert(1)")
            #expect(article.byline.runs.allSatisfy { $0.link == nil })
            // What the feed has for LigaInsider's own articles: no page to open.
            article.source = .init(name: "LigaInsider", url: "https://LigaInsider")
            #expect(article.byline.runs.allSatisfy { $0.link == nil })
        }
    }
}
