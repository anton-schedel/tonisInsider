import Foundation
import Observation
import SwiftUI

// Live scores on match cards, as on the website (Base.astro's window.__applyLive, src/lib/liveClient.ts): score and
// end come from the site's /api/live/ (LigaInsider's match bar, else ESPN); OpenLigaDB, asked directly like the
// website's pages do, only adds the goal scorers.

/// A game as /api/live/ answers it (src/lib/live.ts LiScore): club slugs, the score once it started, and whether
/// the source says it's over.
struct LiveScore: Codable, Hashable, Sendable {
    var home: String
    var away: String
    var score: [Int]?
    var finished: Bool
}

/// A goal as OpenLigaDB lists it: the score after it, so its side is the one whose number went up.
struct LiveGoal: Codable, Hashable, Sendable {
    var minute: Int?
    var name: String
    var home: Int
    var away: Int
    var penalty: Bool
    var own: Bool
}

/// A game of OpenLigaDB's current matchday, reduced to what the cards show (src/lib/live.ts parseLive).
struct LiveMatch: Codable, Hashable, Sendable {
    /// The clubs' names as OpenLigaDB writes them.
    var home: String
    var away: String
    var finished: Bool
    var score: [Int]
    var goals: [LiveGoal]

    static let url = URL(string: "https://api.openligadb.de/getmatchdata/bl1")!

    /// OpenLigaDB's answer; anything that isn't a match list gives none. The score is the latest goal or result,
    /// else 0:0.
    static func parse(_ data: Data) -> [LiveMatch] {
        guard let list = (try? JSONSerialization.jsonObject(with: data)) as? [Any] else { return [] }
        return list.compactMap { item in
            guard let m = item as? [String: Any],
                  let home = (m["team1"] as? [String: Any])?["teamName"] as? String, !home.isEmpty,
                  let away = (m["team2"] as? [String: Any])?["teamName"] as? String, !away.isEmpty,
                  m["matchDateTimeUTC"] is String
            else { return nil }
            let goals = (m["goals"] as? [[String: Any]] ?? []).map { g in
                LiveGoal(minute: g["matchMinute"] as? Int, name: g["goalGetterName"] as? String ?? "",
                         home: g["scoreTeam1"] as? Int ?? 0, away: g["scoreTeam2"] as? Int ?? 0,
                         penalty: g["isPenalty"] as? Bool ?? false, own: g["isOwnGoal"] as? Bool ?? false)
            }
            let result = (m["matchResults"] as? [[String: Any]] ?? [])
                .max { ($0["resultOrderID"] as? Int ?? 0) < ($1["resultOrderID"] as? Int ?? 0) }
            // Results are entered after the half and the match; goals as they happen. Take whichever is further on.
            let fromGoals = goals.last.map { [$0.home, $0.away] } ?? [0, 0]
            let fromResult = result.map { [$0["pointsTeam1"] as? Int ?? 0, $0["pointsTeam2"] as? Int ?? 0] } ?? [0, 0]
            let score = fromResult[0] + fromResult[1] > fromGoals[0] + fromGoals[1] ? fromResult : fromGoals
            return LiveMatch(home: home, away: away, finished: m["matchIsFinished"] as? Bool ?? false, score: score, goals: goals)
        }
    }
}

/// What a match card shows from kickoff on: the score, "Live" or "Ende", and (club page) the scorers.
struct LiveState: Hashable, Sendable {
    var home: Int
    var away: Int
    var finished: Bool
    var goals: [LiveGoal]

    init(home: Int, away: Int, finished: Bool, goals: [LiveGoal]) {
        self.home = home
        self.away = away
        self.finished = finished
        self.goals = goals
    }

    /// The website's rules (window.__applyLive): nothing before kickoff or without a score from /api/live/.
    /// A game counts as over at the latest 2 h 10 min after kickoff, whatever the sources say, and never before
    /// 1 h 45 min (90 minutes and the break): LigaInsider's "Noten" link isn't proof it's over. OpenLigaDB only
    /// adds the scorers when its score agrees: its own scores were wrong too often to show.
    init?(_ fixture: Fixture, scores: [LiveScore], matches: [LiveMatch], now: Date) {
        guard let kickoff = fixture.kickoff, kickoff <= now, let home = fixture.home, let away = fixture.away,
              let li = scores.first(where: { $0.home == home && $0.away == away }),
              let score = li.score, score.count == 2
        else { return nil }
        let key = { (name: String) in name.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
        let ol = matches.first { key($0.home) == key(fixture.homeName) && key($0.away) == key(fixture.awayName) }
        self.init(home: score[0], away: score[1],
                  finished: (li.finished && now > kickoff.addingTimeInterval(105 * 60)) || now > kickoff.addingTimeInterval(130 * 60),
                  goals: ol?.score == score ? ol?.goals ?? [] : [])
    }

    /// The scorers in two columns, home and away, in the order the goals fell: "12' S. Guirassy", "(11m)" for a
    /// penalty, "(ET)" for an own goal.
    var scorers: (home: [String], away: [String]) {
        var columns: (home: [String], away: [String]) = ([], [])
        var before = 0
        for g in goals {
            let line = (g.minute.map { "\($0)' " } ?? "") + g.name + (g.penalty ? " (11m)" : "") + (g.own ? " (ET)" : "")
            if g.home > before { columns.home.append(line) } else { columns.away.append(line) }
            before = g.home
        }
        return columns
    }
}

/// When to ask for the scores (liveClient.ts tick): only while one of the matchday's games runs.
enum LivePoll {
    /// Every 30 s while a game runs; a game counts as running from kickoff for 3 h.
    static let every: TimeInterval = 30
    static let running: TimeInterval = 3 * 3600

    struct Plan: Equatable {
        /// Ask now.
        var fetch: Bool
        /// Seconds until the next look; nil: every game is over, nothing more to ask.
        var next: TimeInterval?
    }

    /// `lastAt`: when the scores kept were answered. Between and after the games one look is enough (the final
    /// scores of those that ended since); before a kickoff it waits for it.
    static func plan(kickoffs: [Date], now: Date, lastAt: Date?) -> Plan {
        let started = kickoffs.filter { $0 <= now }
        let isRunning = started.contains { now < $0.addingTimeInterval(running) }
        let lastEnd = started.map { $0.addingTimeInterval(running) }.filter { $0 <= now }.max()
        var fetch = false
        if !started.isEmpty {
            if let lastAt {
                // An answer up to 5 s short of the interval is fresh enough: another page asked just now.
                fetch = lastEnd.map { lastAt < $0 } ?? false || (isRunning && now.timeIntervalSince(lastAt) >= every - 5)
            } else {
                fetch = true
            }
        }
        if isRunning { return Plan(fetch: fetch, next: every) }
        let nextKickoff = kickoffs.filter { $0 > now }.min()
        return Plan(fetch: fetch, next: nextKickoff.map { $0.timeIntervalSince(now) })
    }
}

/// The matchday's live scores, one for the whole app (the website's copy in sessionStorage): asked while a game
/// runs and a page with match cards is in front; the last answer is kept on the phone, so the cards have their
/// scores at once when they're shown.
@Observable @MainActor
final class LiveScoresModel {
    static let shared = LiveScoresModel()

    /// From /api/live/: score and end.
    private(set) var scores: [LiveScore] = []
    /// From OpenLigaDB: the scorers.
    private(set) var matches: [LiveMatch] = []
    /// When they were answered.
    private(set) var at: Date?

    private let api: API
    private let session: URLSession
    private let defaults: UserDefaults?
    private let interval: Duration
    private var asking = false

    private struct Stored: Codable { var at: Date; var li: [LiveScore]; var matches: [LiveMatch] }
    private static let key = "liveScores"

    /// `session`: for OpenLigaDB, which isn't ours: it gets neither the app's header nor the session token.
    init(api: API = .shared, session: URLSession = URLSession(configuration: .ephemeral), defaults: UserDefaults? = .standard,
         interval: Duration = .seconds(LivePoll.every)) {
        self.api = api
        self.session = session
        self.defaults = defaults
        self.interval = interval
        if let data = defaults?.data(forKey: Self.key), let stored = try? JSONDecoder().decode(Stored.self, from: data) {
            scores = stored.li
            matches = stored.matches
            at = stored.at
        }
    }

    func state(of fixture: Fixture, now: Date) -> LiveState? {
        LiveState(fixture, scores: scores, matches: matches, now: now)
    }

    /// Asks as LivePoll says until every game of the matchday is over (or the page closes, or the app leaves the
    /// front: the task is cancelled).
    func run(kickoffs: [Date], now: @escaping () -> Date = { .now }) async {
        while !Task.isCancelled {
            let plan = LivePoll.plan(kickoffs: kickoffs, now: now(), lastAt: at)
            if plan.fetch { await ask(now: now()) }
            guard let next = plan.next else { return }
            // While a game runs: the model's interval (30 s). Else until the next kickoff, half a second past it,
            // so the clock surely says kickoff when the sleep ends.
            try? await Task.sleep(for: next == LivePoll.every ? interval : .seconds(next + 0.5))
        }
    }

    /// Both sources at once; one that fails keeps its last answer, and an empty answer (both down) keeps the scores
    /// already shown.
    private func ask(now: Date) async {
        // Two pages open (the matchday behind a club's page): one of them asks.
        guard !asking else { return }
        asking = true
        defer { asking = false }
        async let site: [LiveScore]? = try? api.get("api/live/")
        async let openLiga = openLiga()
        let (li, ol) = await (site, openLiga)
        guard li != nil || ol != nil else { return }
        if let li, !li.isEmpty { scores = li }
        if let ol { matches = ol }
        at = now
        if let data = try? JSONEncoder().encode(Stored(at: now, li: scores, matches: matches)) { defaults?.set(data, forKey: Self.key) }
    }

    private func openLiga() async -> [LiveMatch]? {
        var request = URLRequest(url: LiveMatch.url)
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.timeoutInterval = 10
        guard let (data, response) = try? await session.data(for: request), (response as? HTTPURLResponse)?.statusCode == 200 else { return nil }
        return LiveMatch.parse(data)
    }
}

extension View {
    /// Keeps the live scores of these matches coming while this page is shown and the app is in front.
    func liveScores(of fixtures: [Fixture]) -> some View {
        modifier(LiveScoresPolling(kickoffs: fixtures.compactMap(\.kickoff)))
    }
}

private struct LiveScoresPolling: ViewModifier {
    let kickoffs: [Date]
    @Environment(\.scenePhase) private var scenePhase

    private struct Asking: Equatable { var active: Bool; var kickoffs: [Date] }

    func body(content: Content) -> some View {
        // Anew when the app comes to the front and when the feed brings other kickoffs.
        content.task(id: Asking(active: scenePhase == .active, kickoffs: kickoffs)) {
            if scenePhase == .active { await LiveScoresModel.shared.run(kickoffs: kickoffs) }
        }
    }
}
