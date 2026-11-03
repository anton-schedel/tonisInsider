import Foundation

/// Mein Team as /api/app/my-team/ serves it (src/lib/myTeam.ts AppTeam): the page's view, players by Kickbase id.
struct AppTeam: Codable, Sendable {
    var signedOut: String?
    var error: String?
    var leagues: [League] = []
    var leagueId: String?
    var points: Int?
    var started = false
    var running = false
    var formation: String = ""
    /// The XI, goalkeeper line first (Kickbase ids).
    var lines: [[String]] = []
    /// Everyone else; with no lineup set, the whole squad.
    var bench: [String] = []
    var players: [String: Player] = [:]
    var summary: Summary?
    var account: AccountInfo?

    struct League: Codable, Hashable, Sendable { var id: String; var name: String }
    struct AccountInfo: Codable, Sendable { var name: String?; var userId: String? }

    struct Player: Codable, Hashable, Sendable, Identifiable {
        var id: String
        var name: String
        /// 1 goalkeeper … 4 forward.
        var position: Int
        var image: String?
        var live: Live?
        var card: PlayerCardData
        var freshNews: Bool
        var status: StartStatus?
        var note: String?
        var rival: String?
    }

    /// A player's match today: 0 not started, 1 running, 2 over; Kickbase points once he has any.
    struct Live: Codable, Hashable, Sendable { var state: Int; var points: Int?; var minute: Int?; var kickoff: Date? }

    enum StartStatus: String, Codable, Sendable { case confirmed, start, contested, doubtful, alternative, bench, unknown }

    /// The matchday summary (src/lib/summary/compose.ts SummaryView).
    struct Summary: Codable, Hashable, Sendable {
        var inXi: Int
        var total: Int
        var text: [String]
        var games: [Game]
        var notes: [String]

        struct Game: Codable, Hashable, Sendable {
            var team: String
            var opponent: String
            var home: Bool
            var win: Int
            var kickoff: Date
            var crest: String?
            var players: [Named]
        }
        struct Named: Codable, Hashable, Sendable { var name: String; var note: String? }
    }

    private enum CodingKeys: String, CodingKey {
        case signedOut, error, leagues, leagueId, points, started, running, formation, lines, bench, players, summary, account
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        signedOut = try c.decodeIfPresent(String.self, forKey: .signedOut)
        error = try c.decodeIfPresent(String.self, forKey: .error)
        leagues = try c.decodeIfPresent([League].self, forKey: .leagues) ?? []
        leagueId = try c.decodeIfPresent(String.self, forKey: .leagueId)
        points = try c.decodeIfPresent(Int.self, forKey: .points)
        started = try c.decodeIfPresent(Bool.self, forKey: .started) ?? false
        running = try c.decodeIfPresent(Bool.self, forKey: .running) ?? false
        formation = try c.decodeIfPresent(String.self, forKey: .formation) ?? ""
        lines = try c.decodeIfPresent([[String]].self, forKey: .lines) ?? []
        bench = try c.decodeIfPresent([String].self, forKey: .bench) ?? []
        players = try c.decodeIfPresent([String: Player].self, forKey: .players) ?? [:]
        summary = try c.decodeIfPresent(Summary.self, forKey: .summary)
        account = try c.decodeIfPresent(AccountInfo.self, forKey: .account)
    }
}
