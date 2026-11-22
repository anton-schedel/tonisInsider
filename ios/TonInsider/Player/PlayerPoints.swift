import SwiftUI

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
    /// Being loaded right now: a press and the tap that follows it ask once.
    private var loading: [String: Task<PlayerPoints, Error>] = [:]

    init(api: API = .shared) { self.api = api }

    /// His breakdown if it's loaded and still fresh: the card shows it at once.
    func fresh(_ id: String, now: Date = .now) -> PlayerPoints? {
        guard let hit = cache[id], now.timeIntervalSince(hit.at) < (hit.data.live.state == 2 ? 600 : 30) else { return nil }
        return hit.data
    }

    func load(_ id: String, now: Date = .now) async throws -> PlayerPoints {
        if let hit = fresh(id, now: now) { return hit }
        if let running = loading[id] { return try await running.value }
        let task = Task { [api] in try await api.get("api/kickbase/player/\(id)/") as PlayerPoints }
        loading[id] = task
        defer { loading[id] = nil }
        let data = try await task.value
        cache[id] = (now, data)
        return data
    }

    /// Asked for from the press on (a finger is down a moment before the tap counts), so it is mostly there when
    /// the card opens instead of arriving while it slides in (PlayerCard.astro warm).
    func warm(_ id: String) {
        guard fresh(id) == nil, loading[id] == nil else { return }
        Task { _ = try? await load(id) }
    }

    /// The lines the card shows: the six biggest first, the rest one tap away ("Alle N Aktionen").
    static let shownLines = 6
    static func visible(_ lines: [PlayerPoints.Line], all: Bool) -> (shown: [PlayerPoints.Line], hidden: Int) {
        all || lines.count <= shownLines ? (lines, 0) : (Array(lines.prefix(shownLines)), lines.count - shownLines)
    }
}

/// The press of a player whose card shows his points (from kickoff on): it gives like any other (PressStyle), and
/// his breakdown is asked for while the finger is still down.
struct CardPressStyle: ButtonStyle {
    var scale: CGFloat = 0.95
    /// His Kickbase id from kickoff on, nil before (then the card shows the odds and nothing is loaded).
    let kickbaseId: String?

    func makeBody(configuration: Configuration) -> some View {
        PressStyle(scale: scale).makeBody(configuration: configuration)
            .onChange(of: configuration.isPressed) { _, pressed in
                if pressed, let kickbaseId { PointsBreakdown.shared.warm(kickbaseId) }
            }
    }
}
