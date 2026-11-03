import Foundation
import Observation

/// The scout list (src/lib/scoutClient.ts): with a Kickbase or LigaInsider login it's the account's list on the
/// server (the same as on the website); without, it's kept on the phone and joins the account's list at the next login.
struct ScoutState: Codable, Equatable, Sendable {
    var ids: [Int] = []
    /// When each player was put on the list (by id): news before that isn't new.
    var added: [String: Date] = [:]
    var seenAt: Date?
    var account = false

    /// Scouted players with news since the list was last looked at (posts scheduled for later don't count yet).
    func unseen(in feed: AppFeed, now: Date = .now) -> [Int] {
        let newest = Dictionary(feed.visibleArticles(now: now).compactMap { a in a.player.map { ($0.id, a.publishedAt) } }, uniquingKeysWith: max)
        return ids.filter { id in
            guard let news = newest[id] else { return false }
            let since = max(seenAt ?? .distantPast, added[String(id)] ?? .distantPast)
            return news > since
        }
    }
}

@Observable @MainActor
final class ScoutStore {
    private(set) var state = ScoutState()
    /// What went wrong last (shown briefly); cleared by the screen.
    var message: String?
    /// Players whose change is on its way: taps on them wait.
    private var pending = Set<Int>()

    private let api: API
    private let defaults: UserDefaults
    private let signedIn: () -> Bool

    init(api: API = .shared, defaults: UserDefaults = .standard, signedIn: @escaping () -> Bool) {
        self.api = api
        self.defaults = defaults
        self.signedIn = signedIn
        // The account's last known list at once (also offline), else the phone's.
        state = signedIn() ? last ?? local : local
    }

    func contains(_ id: Int) -> Bool { state.ids.contains(id) }

    func load() async {
        guard signedIn() else { state = local; return }
        // Not reachable: the list on screen stays (the site keeps its last known one too).
        guard var server = await call(nil) else { return }
        // Players picked before logging in join the account's list.
        let before = local.ids.filter { !server.ids.contains($0) }
        if !before.isEmpty, let merged = await call(Change(add: before)) {
            server = merged
            defaults.removeObject(forKey: Keys.list)
            defaults.removeObject(forKey: Keys.added)
        }
        state = server
    }

    /// Shown at once; with an account the server's answer follows, and a failure puts it back.
    func set(_ id: Int, on: Bool) async {
        guard !pending.contains(id) else { return }
        if state.account || signedIn() {
            pending.insert(id)
            defer { pending.remove(id) }
            let before = state
            state.ids = on ? [id] + state.ids.filter { $0 != id } : state.ids.filter { $0 != id }
            if let next = await call(on ? Change(add: [id]) : Change(remove: [id])) { state = next }
            else { state = before; message = "Konnte nicht gespeichert werden." }
            return
        }
        var s = local
        s.ids = on ? [id] + s.ids.filter { $0 != id } : s.ids.filter { $0 != id }
        if on { s.added[String(id)] = .now } else { s.added[String(id)] = nil }
        if on && s.seenAt == nil { s.seenAt = .now }
        save(s)
        state = local
    }

    /// The list was looked at: news until now is no longer new.
    func markSeen() async {
        if state.account {
            if let next = await call(Change(seen: true)) { state = next }
            return
        }
        var s = local
        s.seenAt = .now
        save(s)
        state = local
    }

    // MARK: server and phone

    private struct Change: Encodable { var add: [Int]? = nil; var remove: [Int]? = nil; var seen: Bool? = nil }
    private struct Answer: Decodable { var ids: [Int]; var added: [String: Date]?; var seenAt: Date? }

    private func call(_ change: Change?) async -> ScoutState? {
        do {
            let answer: Answer = if let change { try await api.post("api/scout/", json: change) } else { try await api.get("api/scout/") }
            let s = ScoutState(ids: answer.ids, added: answer.added ?? [:], seenAt: answer.seenAt, account: true)
            if let data = try? JSONEncoder.site.encode(s) { defaults.set(data, forKey: Keys.last) }
            return s
        } catch {
            return nil
        }
    }

    private enum Keys { static let list = "scoutList", added = "scoutAdded", seen = "scoutSeen", last = "scoutLast" }

    /// The account's list as last seen from the server.
    private var last: ScoutState? {
        defaults.data(forKey: Keys.last).flatMap { try? JSONDecoder.site.decode(ScoutState.self, from: $0) }
    }

    private var local: ScoutState {
        ScoutState(ids: defaults.array(forKey: Keys.list) as? [Int] ?? [],
                   added: (defaults.dictionary(forKey: Keys.added) as? [String: Date]) ?? [:],
                   seenAt: defaults.object(forKey: Keys.seen) as? Date, account: false)
    }

    private func save(_ s: ScoutState) {
        defaults.set(s.ids, forKey: Keys.list)
        defaults.set(s.added, forKey: Keys.added)
        defaults.set(s.seenAt, forKey: Keys.seen)
    }
}
