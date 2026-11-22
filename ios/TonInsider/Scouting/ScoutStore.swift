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
    /// What went wrong last, shown where the star or the + was tapped (ScoutProblem) and cleared by it.
    var message: String?
    /// Players whose change is on its way: taps on them wait.
    private var pending = Set<Int>()
    /// Only the newest load may show its answer: the list belongs to the Kickbase login, else to the LigaInsider
    /// one (src/lib/scout.ts scoutOwner), so a late answer from before a login or logout is another account's list.
    private var loads = 0

    private let api: API
    private let defaults: UserDefaults
    private let signedIn: () -> Bool

    /// At most this many players on an account's list (src/lib/scout.ts SCOUT_MAX).
    static let limit = 100

    init(api: API = .shared, defaults: UserDefaults = .standard, signedIn: @escaping () -> Bool) {
        self.api = api
        self.defaults = defaults
        self.signedIn = signedIn
        // The account's last known list at once (also offline), else the phone's.
        state = signedIn() ? last ?? local : local
    }

    func contains(_ id: Int) -> Bool { state.ids.contains(id) }

    /// The list as the account has it now. Called at the start and whenever a login comes or goes: with both
    /// logins the list is the Kickbase account's, so adding or removing either one can change whose list it is.
    func load() async {
        loads += 1
        let mine = loads
        guard signedIn() else { state = local; return }
        // Not reachable: the list on screen stays (the site keeps its last known one too).
        guard var server = try? await call(nil), mine == loads else { return }
        // Players picked before logging in join the account's list.
        let before = local.ids.filter { !server.ids.contains($0) }
        if !before.isEmpty, let merged = try? await call(Change(add: before)) {
            server = merged
            defaults.removeObject(forKey: Keys.list)
            defaults.removeObject(forKey: Keys.added)
        }
        guard mine == loads else { return }
        remember(server)
    }

    /// Shown at once; with an account the server's answer follows, and a failure puts it back and says why
    /// (`message`). True once the change is saved.
    @discardableResult
    func set(_ id: Int, on: Bool) async -> Bool {
        guard !pending.contains(id) else { return false }
        message = nil
        if state.account || signedIn() {
            pending.insert(id)
            defer { pending.remove(id) }
            let before = state
            state.ids = on ? [id] + state.ids.filter { $0 != id } : state.ids.filter { $0 != id }
            do {
                let next = try await call(on ? Change(add: [id]) : Change(remove: [id]))
                remember(next)
                // A full list: the site leaves him out and answers with the list as it is (src/pages/api/scout.ts).
                if on, !next.ids.contains(id) {
                    message = "Deine Scoutliste ist voll: mehr als \(Self.limit) Spieler passen nicht darauf."
                    return false
                }
                return true
            } catch {
                state = before
                // The site's own words when it sends some ("Nicht erlaubt."), else what the website says.
                message = (error as? APIError)?.message ?? "Konnte nicht gespeichert werden."
                return false
            }
        }
        var s = local
        s.ids = on ? [id] + s.ids.filter { $0 != id } : s.ids.filter { $0 != id }
        if on { s.added[String(id)] = .now } else { s.added[String(id)] = nil }
        if on && s.seenAt == nil { s.seenAt = .now }
        save(s)
        state = local
        return true
    }

    /// The list was looked at: news until now is no longer new.
    func markSeen() async {
        if state.account {
            if let next = try? await call(Change(seen: true)) { remember(next) }
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

    private func call(_ change: Change?) async throws -> ScoutState {
        let answer: Answer = if let change { try await api.post("api/scout/", json: change) } else { try await api.get("api/scout/") }
        return ScoutState(ids: answer.ids, added: answer.added ?? [:], seenAt: answer.seenAt, account: true)
    }

    /// The account's list as the server just told it: on screen, and kept for the next launch.
    private func remember(_ s: ScoutState) {
        state = s
        if let data = try? JSONEncoder.site.encode(s) { defaults.set(data, forKey: Keys.last) }
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
