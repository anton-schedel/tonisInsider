import Foundation
import Testing
@testable import TonInsider

/// Answers every request with what `handler` returns (or throws), for the feed store's network.
final class StubProtocol: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var handler: (@Sendable (URLRequest) throws -> (HTTPURLResponse, Data))?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        do {
            let (response, data) = try Self.handler!(request)
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }
    override func stopLoading() {}

    static func session() -> URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StubProtocol.self]
        return URLSession(configuration: config)
    }
}

/// A value a stub writes on URLSession's thread and the test reads afterwards.
final class Box<T>: @unchecked Sendable {
    private let lock = NSLock()
    private var stored: T
    init(_ value: T) { stored = value }
    var value: T {
        get { lock.withLock { stored } }
        set { lock.withLock { stored = newValue } }
    }
}

func fixture(_ name: String) throws -> Data {
    let url = Bundle(for: StubProtocol.self).url(forResource: name, withExtension: "json")!
    return try Data(contentsOf: url)
}

func response(_ status: Int, _ headers: [String: String] = [:]) -> HTTPURLResponse {
    HTTPURLResponse(url: URL(string: "https://site.example/")!, statusCode: status, httpVersion: nil, headerFields: headers)!
}

/// Every test that answers requests through StubProtocol (one shared handler) runs one after another.
@Suite(.serialized) enum NetworkTests {}

let berlinNow = ISO8601DateFormatter().date(from: "2026-11-03T12:00:00Z")!

extension NetworkTests {
    @Suite(.serialized) @MainActor
    struct FeedTests {
        @Test func decodesTheFixture() throws {
            let feed = try AppFeed.decode(try fixture("app-feed"))
            #expect(feed.articles.count == 6)
            #expect(feed.articles.first { $0.id == 420100 }?.player?.name == "Harry Kane")
            #expect(feed.articles.first { $0.id == 420099 }?.ratings?.first?.lines.first?.first?.player.grade == 2)
            #expect(feed.lineups.first?.opponent?.home == true)
            #expect(feed.odds?.first?.chances.home == 78)
            #expect(feed.commentCounts["420100"] == 12)
        }

        @Test func hidesPostsUntilTheirMinute() throws {
            let feed = try AppFeed.decode(try fixture("app-feed"))
            #expect(!feed.visibleArticles(now: berlinNow).map(\.id).contains(900000003))
            #expect(feed.visibleArticles(now: berlinNow.addingTimeInterval(7 * 3600)).map(\.id).contains(900000003))
        }

        @Test func unpinsAfterPinnedUntil() throws {
            let feed = try AppFeed.decode(try fixture("app-feed"))
            #expect(feed.pinnedArticles(now: berlinNow).map(\.id) == [900000002])
            // A day later the own post's pin has run out; the other pinned id (no pinnedUntil) is out by then.
            #expect(feed.pinnedArticles(now: berlinNow.addingTimeInterval(86400)).map(\.id) == [900000003])
        }

        @Test func groupsByBerlinDay() throws {
            let feed = try AppFeed.decode(try fixture("app-feed"))
            let groups = feed.dayGroups(now: berlinNow)
            // 23:30 UTC on 1 Nov is 00:30 on 2 Nov in Berlin; the match report at 20:00 UTC stays on 1 Nov.
            // The pinned own post is only on top while pinned (like the web's NewsFeed), in the feed afterwards.
            #expect(groups.map { $0.items.map(\.id) } == [[420050, 420100], [420099], [420040]])
            #expect(feed.dayGroups(now: berlinNow.addingTimeInterval(86400)).first?.items.first?.id == 900000002)
        }

        @Test func keepsTheCachedFeedWhenTheRefreshFails() async throws {
            let dir = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
            StubProtocol.handler = { _ in (response(200, ["ETag": "\"a\""]), try fixture("app-feed")) }
            let store = FeedStore(session: StubProtocol.session(), directory: dir)
            await store.refresh()
            #expect(store.feed?.articles.count == 6)
            StubProtocol.handler = { _ in throw URLError(.notConnectedToInternet) }
            await store.refresh()
            #expect(store.feed?.articles.count == 6)
            #expect(store.lastError != nil)
            // A new launch shows the stored feed at once.
            let again = FeedStore(session: StubProtocol.session(), directory: dir)
            again.loadCached()
            #expect(again.feed?.articles.count == 6)
        }

        @Test func notModifiedKeepsTheFeed() async throws {
            let dir = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
            StubProtocol.handler = { _ in (response(200, ["ETag": "\"a\""]), try fixture("app-feed")) }
            let store = FeedStore(session: StubProtocol.session(), directory: dir)
            await store.refresh()
            let sent = Box<String?>(nil)
            StubProtocol.handler = { request in
                sent.value = request.value(forHTTPHeaderField: "If-None-Match")
                return (response(304), Data())
            }
            await store.refresh()
            #expect(sent.value == "\"a\"")
            #expect(store.feed?.articles.count == 6)
            #expect(store.lastError == nil)
        }
    }
}
