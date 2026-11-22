import Foundation
import Observation

/// The feed, kept on the phone: shown at once on launch, then refreshed quietly with a conditional GET
/// (the site's static files carry an ETag, so an unchanged feed costs a 304). A failed refresh keeps what's shown.
/// The comment counts come live on top of it (the feed has those of its last build, and none for our own posts).
@Observable @MainActor
final class FeedStore {
    private(set) var feed: AppFeed? {
        // Only a new feed: live comment counts change the feed too, and they don't touch the players.
        didSet { if let feed, feed.generatedAt != oldValue?.generatedAt { Task { await index(feed) } } }
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
        guard feed == nil, let cached = try? await Self.read(file) else { return }
        if feed == nil { feed = withLiveCounts(cached) }
    }

    /// The stored feed, read and decoded off the main thread (a few MB).
    @concurrent private static func read(_ file: URL) async throws -> AppFeed {
        try AppFeed.decode(try Data(contentsOf: file))
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

    private var running: Task<Void, Never>?

    /// One refresh at a time; a pull while one runs waits for it (the spinner stays until the data is in).
    func refresh() async {
        if let running { return await running.value }
        let task = Task {
            // The comment counts with it: as often as the feed, never more. Side by side, so a pull waits no longer
            // than the slower of the two; without a feed yet, afterwards (our own posts' ids come from it).
            if feed == nil {
                await fetch()
                await refreshCounts()
            } else {
                async let counts: Void = refreshCounts()
                await fetch()
                await counts
            }
        }
        running = task
        await task.value
        running = nil
    }

    /// The counts as last asked for, kept over a newer feed and while a later look fails.
    private var liveCounts: [String: Int] = [:]

    private func withLiveCounts(_ feed: AppFeed) -> AppFeed {
        var feed = feed
        feed.commentCounts.merge(liveCounts) { _, live in live }
        return feed
    }

    /// Our own posts' ids start here (src/lib/ownComments.ts OWN_POST_MIN_ID).
    static let ownPostMinId = 900_000_000

    /// The live comment counts (src/components/ArticleRow.astro's script): LigaInsider's newest articles, and our
    /// own posts' from our database (`own`, at most 50 as the site takes them). They go into the feed's counts, so
    /// every row shows them. A failed look changes nothing.
    func refreshCounts() async {
        guard let feed else { return }
        let own = feed.articles.filter { $0.id >= Self.ownPostMinId }.prefix(50).map { String($0.id) }
        var url = AppConfig.siteURL.appending(path: "api/comment-counts/")
        if !own.isEmpty { url.append(queryItems: [URLQueryItem(name: "own", value: own.joined(separator: ","))]) }
        var request = URLRequest(url: url)
        request.cachePolicy = .reloadIgnoringLocalCacheData
        // LigaInsider can be slow; the counts aren't worth a long wait.
        request.timeoutInterval = 8
        guard let (data, response) = try? await session.data(for: request),
              (response as? HTTPURLResponse)?.statusCode == 200,
              let counts = try? JSONDecoder().decode([String: Int].self, from: data)
        else { return }
        liveCounts.merge(counts) { _, fresh in fresh }
        // Unchanged counts leave the feed alone: nothing redraws.
        if let now = self.feed, counts.contains(where: { now.commentCounts[$0.key] != $0.value }) {
            self.feed = withLiveCounts(now)
        }
    }

    private func fetch() async {
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
            feed = withLiveCounts(fresh)
            lastError = nil
            try? data.write(to: file, options: .atomic)
            if let etag = (response as? HTTPURLResponse)?.value(forHTTPHeaderField: "ETag") {
                try? etag.write(to: etagFile, atomically: true, encoding: .utf8)
            }
        } catch {
            // Given up on purpose is no failure.
            if error is CancellationError || (error as? URLError)?.code == .cancelled { return }
            lastError = error
        }
    }
}
