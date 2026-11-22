import Foundation
import Observation

/// A club's Kickbase points this matchday (GET /api/kickbase/club/<slug>/, src/lib/livePoints.ts ClubPoints): its
/// lineup players' points by LigaInsider id, their Kickbase ids, who really played in each slot and who came on.
struct ClubPoints: Codable, Hashable, Sendable {
    var live: Live
    /// Points by LigaInsider id (as a string: JSON object keys).
    var players: [String: Int]
    /// Kickbase id by LigaInsider id, for the breakdown in the player card.
    var ids: [String: String]?
    /// From kickoff on, per predicted starter (LigaInsider id): who started there and who replaced him.
    var slots: [String: SlotPlay]?
    /// Everyone who came on for the club, by minute.
    var subs: [ClubSub]?

    struct Live: Codable, Hashable, Sendable { var state: Int; var minute: Int?; var kickoff: Date? }

    struct SlotPlay: Codable, Hashable, Sendable {
        /// "main": the predicted starter played, "alt": his alternative did.
        var show: String
        var sub: SlotSub?
    }

    struct SlotSub: Codable, Hashable, Sendable { var kb: String; var name: String; var photo: String?; var minute: Int; var points: Int? }

    /// One who came on: his Kickbase id, name, photo, the minute, whom he replaced and his points.
    struct ClubSub: Codable, Hashable, Sendable, Identifiable {
        var kb: String
        var name: String
        var photo: String?
        var minute: Int
        var out: String
        var points: Int?
        var id: String { kb }
    }

    /// The chip for a player: his points in the state of the match.
    func label(_ points: Int?) -> PointsLabel? { PointsLabel(state: live.state, points: points) }
}

/// A club page's points (src/pages/vereine/[slug].astro): from kickoff until the next matchday's lineup replaces this
/// one (4 days at most), asked every 30 seconds while the match runs; the last answer per club shows at once.
@Observable @MainActor
final class ClubPointsModel {
    private(set) var points: ClubPoints?
    /// No points to show and the last answer failed (503 for a club that can't be mapped to Kickbase, 502 when
    /// Kickbase is down, 404, no network): the page shows the pitch as before kickoff instead of placeholders that
    /// may never fill. The asking goes on quietly.
    private(set) var failed = false

    /// What the club page asks with: anew when the app comes to the front, and when the feed brings a kickoff
    /// (or another one) while the page is open.
    struct Asking: Equatable { var active: Bool; var kickoff: Date? }

    /// The match the points and the failure belong to.
    private var match: String?
    private let api: API
    private let interval: Duration
    /// The last answer per club and match, for an instant draw when the page opens again (the app can stay alive
    /// for days: last matchday's answer isn't this one's).
    private static var last: [String: ClubPoints] = [:]
    private static func key(_ slug: String, _ kickoff: Date) -> String { "\(slug)@\(kickoff.timeIntervalSince1970)" }

    init(api: API = .shared, interval: Duration = .seconds(30)) {
        self.api = api
        self.interval = interval
    }

    /// Points matter from kickoff on, until 4 days after it (the website's MAX_AFTER_MS).
    nonisolated static func matters(kickoff: Date?, now: Date) -> Bool {
        guard let kickoff else { return false }
        return kickoff <= now && now < kickoff.addingTimeInterval(4 * 86_400)
    }

    /// Asks while the points matter and the match isn't over; a failed request keeps what's shown. Opened before
    /// kickoff, it waits for it (the page shows the pitch from kickoff on; the task ends when the page closes).
    func run(slug: String, kickoff: Date?, now: @escaping () -> Date = { .now }) async {
        // Another match than the last run's (the feed brought a kickoff, or moved it): its points aren't this one's.
        let key = kickoff.map { Self.key(slug, $0) }
        if key != match {
            match = key
            points = nil
            failed = false
        }
        guard let kickoff, let key else { return }
        let wait = kickoff.timeIntervalSince(now())
        if wait > 0 {
            failed = false
            // Half a second past it, so the clock surely says kickoff when the sleep ends.
            try? await Task.sleep(for: .seconds(wait + 0.5))
            if Task.isCancelled { return }
        }
        guard Self.matters(kickoff: kickoff, now: now()) else { return }
        if points == nil, let cached = Self.last[key] { points = cached }
        while !Task.isCancelled {
            if let fresh: ClubPoints = try? await api.get("api/kickbase/club/\(slug)/") {
                points = fresh
                failed = false
                Self.last[key] = fresh
                if fresh.live.state == 2 { return }
            } else if !Task.isCancelled {
                // A request cut off because the page closed isn't a failed answer.
                failed = points == nil
            }
            try? await Task.sleep(for: interval)
            guard Self.matters(kickoff: kickoff, now: now()) else { return }
        }
    }
}
