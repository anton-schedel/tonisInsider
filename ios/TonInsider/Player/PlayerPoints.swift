import Foundation

/// A player's points this matchday and the actions behind them (GET /api/kickbase/player/<Kickbase id>/,
/// src/lib/livePoints.ts PlayerPoints): biggest effect first, actions worth nothing left out.
struct PlayerPoints: Codable, Hashable, Sendable {
    var live: AppTeam.Live
    var lines: [Line]

    struct Line: Codable, Hashable, Sendable {
        var name: String
        var count: Int
        var points: Int
    }
}

/// The breakdowns the card has loaded (a player tapped again shows his at once): fresh for 30 seconds while his
/// match runs, 10 minutes once it's over (the website's PlayerCard.astro).
@MainActor
final class PointsBreakdown {
    static let shared = PointsBreakdown()

    private let api: API
    private var cache: [String: (at: Date, data: PlayerPoints)] = [:]

    init(api: API = .shared) { self.api = api }

    func load(_ id: String, now: Date = .now) async throws -> PlayerPoints {
        if let hit = cache[id], now.timeIntervalSince(hit.at) < (hit.data.live.state == 2 ? 600 : 30) { return hit.data }
        let data: PlayerPoints = try await api.get("api/kickbase/player/\(id)/")
        cache[id] = (now, data)
        return data
    }

    /// The lines the card shows: the six biggest first, the rest one tap away ("Alle N Aktionen").
    static let shownLines = 6
    static func visible(_ lines: [PlayerPoints.Line], all: Bool) -> (shown: [PlayerPoints.Line], hidden: Int) {
        all || lines.count <= shownLines ? (lines, 0) : (Array(lines.prefix(shownLines)), lines.count - shownLines)
    }
}
