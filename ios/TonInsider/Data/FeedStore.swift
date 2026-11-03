import Foundation
import Observation

/// The feed, kept on the phone: shown at once on launch, then refreshed quietly with a conditional GET
/// (the site's static files carry an ETag, so an unchanged feed costs a 304). A failed refresh keeps what's shown.
@Observable @MainActor
final class FeedStore {
    private(set) var feed: AppFeed? {
        didSet { if let feed { Task { await index(feed) } } }
    }
    /// Every squad player with his card (search, scout list), built in the background whenever the feed changes.
    private(set) var players: [Int: PlayerEntry] = [:]
    private(set) var isRefreshing = false
    private(set) var lastError: Error?

    private let session: URLSession
    private let file: URL
    private let etagFile: URL

    init(session: URLSession = .shared, directory: URL = .cachesDirectory) {
        self.session = session
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        file = directory.appending(path: "app-feed.json")
        etagFile = directory.appending(path: "app-feed.etag")
    }

    /// The stored feed, if any (a broken file is ignored and replaced by the next refresh).
    func loadCached() async {
        guard feed == nil, let data = try? Data(contentsOf: file), let cached = try? await Self.decode(data) else { return }
        if feed == nil { feed = cached }
    }

    private func index(_ feed: AppFeed) async {
        let built = await Self.players(of: feed)
        if self.feed?.generatedAt == feed.generatedAt { players = built }
    }

    @concurrent private static func players(of feed: AppFeed) async -> [Int: PlayerEntry] {
        Dictionary(feed.allPlayers().map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
    }

    /// The feed is a few MB: read off the main thread, so scrolling never stutters while it comes in.
    @concurrent private static func decode(_ data: Data) async throws -> AppFeed {
        try AppFeed.decode(data)
    }

    func refresh() async {
        guard !isRefreshing else { return }
        isRefreshing = true
        defer { isRefreshing = false }
        var request = URLRequest(url: AppConfig.siteURL.appending(path: "data/app-feed.json"))
        request.cachePolicy = .reloadIgnoringLocalCacheData
        if feed != nil, let etag = try? String(contentsOf: etagFile, encoding: .utf8) {
            request.setValue(etag, forHTTPHeaderField: "If-None-Match")
        }
        do {
            let (data, response) = try await session.data(for: request)
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            if status == 304 { lastError = nil; return }
            guard status == 200 else { throw URLError(.badServerResponse) }
            let fresh = try await Self.decode(data)
            feed = fresh
            lastError = nil
            try? data.write(to: file, options: .atomic)
            if let etag = (response as? HTTPURLResponse)?.value(forHTTPHeaderField: "ETag") {
                try? etag.write(to: etagFile, atomically: true, encoding: .utf8)
            }
        } catch {
            lastError = error
        }
    }
}
