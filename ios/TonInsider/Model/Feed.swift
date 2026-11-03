import Foundation

// The site's data as the app gets it (/data/app-feed.json, src/lib/appFeed.ts). Field names and meanings as in
// scraper/types.ts; whatever the app doesn't use is left out (the decoder skips it).

struct AppFeed: Codable, Sendable {
    var version: Int
    var generatedAt: Date
    /// Newest first; posts built in before their minute included (see visibleArticles).
    var articles: [Article]
    /// Ids pinned on top, in order.
    var pinned: [Int]
    var lineups: [Lineup]
    var commentCounts: [String: Int]
    var odds: [OddsEvent]?

    static func decode(_ data: Data) throws -> AppFeed {
        try JSONDecoder.site.decode(AppFeed.self, from: data)
    }
}

struct Ref: Codable, Hashable, Sendable {
    var id: Int
    var slug: String
    var name: String
}

struct PlayerRef: Codable, Hashable, Sendable {
    var id: Int
    var slug: String
    var name: String
    var photo: String?
}

struct ClubRef: Codable, Hashable, Sendable {
    var id: Int
    var slug: String
    var name: String
    var crest: String?
}

enum NewsType: String, Codable, Sendable {
    case verletzung, angeschlagen, aufbautraining, fit, sonstiges
}

struct Article: Codable, Identifiable, Hashable, Sendable {
    var id: Int
    var url: String
    var headline: String
    var newsType: NewsType
    var player: PlayerRef?
    var club: ClubRef?
    var author: String?
    var source: Source?
    var publishedAt: Date
    var bodyHtml: String
    var ratings: [TeamRatings]?
    /// nil: none (or stored before banners existed).
    var banner: String?
    var own: Bool?
    var bannerSize: Size?
    var pinnedUntil: Date?

    struct Source: Codable, Hashable, Sendable { var name: String; var url: String? }
    struct Size: Codable, Hashable, Sendable { var width: Double; var height: Double }

    var isOwn: Bool { own == true }
}

enum RatingMark: String, Codable, Sendable {
    case goal, ownGoal, assist, yellow, yellowRed, red, error
}

struct RatedPlayer: Codable, Hashable, Sendable {
    var id: Int
    var slug: String
    var name: String
    var photo: String?
    var grade: Double?
    var marks: [RatingMark]
}

struct RatedSpot: Codable, Hashable, Sendable {
    var player: RatedPlayer
    var sub: RatedPlayer?
    var minute: Int?
}

struct TeamRatings: Codable, Hashable, Sendable {
    var team: String
    var crest: String?
    var average: Double?
    var lines: [[RatedSpot]]
}

struct LineupPlayer: Codable, Hashable, Sendable {
    var id: Int
    var slug: String
    var name: String
    var photo: String?
    var status: Status
    var statusLabel: String?
    var alternative: PlayerRef?

    enum Status: String, Codable, Sendable { case set, doubtful }
}

struct Lineup: Codable, Hashable, Sendable {
    var club: ClubRef
    var opponent: Opponent?
    var matchday: Int?
    var kickoff: Date?
    var formation: String
    var lines: [[LineupPlayer]]
    var squad: [PlayerRef]?
    /// Where the lineup page's comments hang on LigaInsider.
    var comments: TeamThread?
    var updatedAt: Date

    struct Opponent: Codable, Hashable, Sendable { var name: String; var home: Bool }
    struct TeamThread: Codable, Hashable, Sendable { var tmid: Int; var optauuid: String; var teamid: Int }
}

struct OddsEvent: Codable, Hashable, Sendable {
    var home: String
    var away: String
    var kickoff: Date
    var chances: Chances

    struct Chances: Codable, Hashable, Sendable { var home: Int; var draw: Int; var away: Int }
}

extension JSONDecoder {
    /// The site's dates: ISO 8601, with or without fractional seconds.
    static let site: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let raw = try decoder.singleValueContainer().decode(String.self)
            if let date = try? Date(raw, strategy: .iso8601.year().month().day().time(includingFractionalSeconds: true)) { return date }
            if let date = try? Date(raw, strategy: .iso8601) { return date }
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "not a date: \(raw)"))
        }
        return decoder
    }()
}

extension AppFeed {
    /// What the feed shows now: posts built in before their minute appear only from then on (ArticleRow's data-show-after).
    func visibleArticles(now: Date) -> [Article] {
        articles.filter { $0.publishedAt <= now }
    }

    /// On top, in order: pinned ids that are out and (own posts) whose pin hasn't run out.
    func pinnedArticles(now: Date) -> [Article] {
        let byId = Dictionary(visibleArticles(now: now).map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        return pinned.compactMap { byId[$0] }.filter { $0.pinnedUntil.map { $0 > now } ?? true }
    }

    /// The feed below, by Berlin calendar day. LigaInsider's pinned articles are only on top; our own pinned posts
    /// join the feed once their pin runs out (the web's NewsFeed).
    func dayGroups(now: Date) -> [(day: String, items: [Article])] {
        let onTop = Set(pinned.compactMap { id in articles.first { $0.id == id } }
            .filter { $0.pinnedUntil.map { $0 > now } ?? true }.map(\.id))
        var groups: [(day: String, items: [Article])] = []
        for article in visibleArticles(now: now) where !onTop.contains(article.id) {
            let day = Berlin.dayKey(article.publishedAt)
            if groups.last?.day == day { groups[groups.count - 1].items.append(article) }
            else { groups.append((day, [article])) }
        }
        return groups
    }
}

/// Dates as the site shows them: Europe/Berlin, German.
enum Berlin {
    static let timeZone = TimeZone(identifier: "Europe/Berlin")!
    static let calendar: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = timeZone
        return c
    }()

    private static func format() -> Date.FormatStyle {
        Date.FormatStyle(locale: Locale(identifier: "de_DE"), calendar: calendar, timeZone: timeZone)
    }

    /// "13:00"
    static func time(_ date: Date) -> String {
        date.formatted(format().hour(.twoDigits(amPM: .omitted)).minute(.twoDigits))
    }

    /// "Di. 03.11."
    static func shortDay(_ date: Date) -> String {
        // Foundation writes "Di", the site (Intl) "Di.".
        var weekday = date.formatted(format().weekday(.abbreviated))
        if !weekday.hasSuffix(".") { weekday += "." }
        let day = date.formatted(format().day(.twoDigits).month(.twoDigits))
        return "\(weekday) \(day)"
    }

    /// "Heute · Di. 03.11.", "Gestern · Mo. 02.11.", else "Sa. 31.10." (src/lib/format.ts dayLabel).
    static func dayLabel(_ date: Date, now: Date) -> String {
        let label = shortDay(date)
        if dayKey(date) == dayKey(now) { return "Heute · \(label)" }
        if dayKey(date) == dayKey(now.addingTimeInterval(-86400)) { return "Gestern · \(label)" }
        return label
    }

    /// "03.11.2026 · 13:00" (fullDate)
    static func full(_ date: Date) -> String {
        "\(date.formatted(format().day(.twoDigits).month(.twoDigits).year())) · \(time(date))"
    }

    static func dayKey(_ date: Date) -> String {
        let c = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year!, c.month!, c.day!)
    }
}

/// A site path ("/img/players/1.jpg") as a full URL; absolute URLs stay as they are.
func siteURL(_ path: String?) -> URL? {
    guard let path, !path.isEmpty else { return nil }
    if path.hasPrefix("http") { return URL(string: path) }
    return URL(string: path, relativeTo: AppConfig.siteURL)?.absoluteURL
}
