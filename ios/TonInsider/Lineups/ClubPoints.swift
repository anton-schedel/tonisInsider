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

    private let api: API
    private let interval: Duration
    /// The last answer per club, for an instant draw when the page opens again.
    private static var last: [String: ClubPoints] = [:]

    init(api: API = .shared, interval: Duration = .seconds(30)) {
        self.api = api
        self.interval = interval
    }

    /// Points matter from kickoff on, until 4 days after it (the website's MAX_AFTER_MS).
    nonisolated static func matters(kickoff: Date?, now: Date) -> Bool {
        guard let kickoff else { return false }
        return kickoff <= now && now < kickoff.addingTimeInterval(4 * 86_400)
    }

    /// Asks while the points matter and the match isn't over; a failed request keeps what's shown.
    func run(slug: String, kickoff: Date?, now: @escaping () -> Date = { .now }) async {
        guard Self.matters(kickoff: kickoff, now: now()) else { return }
        if points == nil, let cached = Self.last[slug] { points = cached }
        while !Task.isCancelled {
            if let fresh: ClubPoints = try? await api.get("api/kickbase/club/\(slug)/") {
                points = fresh
                Self.last[slug] = fresh
                if fresh.live.state == 2 { return }
            }
            try? await Task.sleep(for: interval)
            guard Self.matters(kickoff: kickoff, now: now()) else { return }
        }
    }
}
