import Foundation
import Testing
@testable import TonInsider

/// The Scouting page's search and list order (src/pages/scouting.astro search, renderList).
struct ScoutSearchTests {
    private func entry(_ id: Int, _ name: String, _ club: String, rank: Int = 0, news: [Date] = []) -> PlayerEntry {
        var card = PlayerCardData(id: id, name: name)
        card.news = news.enumerated().map { PlayerCardData.CardNews(id: id * 100 + $0.offset, title: "News", type: .sonstiges, at: $0.element) }
        return PlayerEntry(id: id, name: name, club: club, rank: rank, card: card, key: ScoutSearch.key(name: name, club: club))
    }

    private var index: [PlayerEntry] {
        [
            entry(1, "Jamal Musiala", "FC Bayern München"),
            entry(2, "Thomas Müller", "FC Bayern München", rank: 2),
            entry(3, "Serhou Guirassy", "Borussia Dortmund"),
            entry(4, "Julian Brandt", "Borussia Dortmund", rank: 1),
            entry(5, "Jahmai Simpson-Pusey", "1. FC Köln"),
            entry(6, "Tim Kleindienst", "Borussia Mönchengladbach"),
            entry(7, "Kenan Karaman", "FC Schalke 04"),
            entry(8, "Jonas Wind", "VfL Wolfsburg"),
            entry(9, "Andreas Skov Olsen", "VfL Wolfsburg"),
            entry(10, "Mikkel Møller", "Hamburger SV"),
        ]
    }

    private func names(_ query: String) -> [String] { ScoutSearch.search(index, query).hits.map(\.name) }

    @Test func aClubsNicknameFindsItsPlayers() {
        // Starters before alternatives.
        #expect(names("bvb") == ["Serhou Guirassy", "Julian Brandt"])
        #expect(names("gladbach") == ["Tim Kleindienst"])
        #expect(names("s04") == ["Kenan Karaman"])
        #expect(names("BVB ") == ["Serhou Guirassy", "Julian Brandt"])
    }

    @Test func everyWordMustMatch() {
        #expect(names("musiala bayern") == ["Jamal Musiala"])
        #expect(names("musiala dortmund").isEmpty)
        #expect(names("jamal fcb") == ["Jamal Musiala"])
    }

    @Test func germanSpellingsWithoutUmlautsFindTheNamesWithThem() {
        #expect(names("mueller") == ["Thomas Müller"])
        #expect(names("muller") == ["Thomas Müller"])
        #expect(names("Müller") == ["Thomas Müller"])
        #expect(names("koeln") == ["Jahmai Simpson-Pusey"])
        #expect(names("moller") == ["Mikkel Møller"])
    }

    @Test func hyphensAndDotsCountAsSpaces() {
        #expect(names("simpson-pusey") == ["Jahmai Simpson-Pusey"])
        #expect(names("simpson pusey") == ["Jahmai Simpson-Pusey"])
        #expect(names("pusey") == ["Jahmai Simpson-Pusey"])
        #expect(names("1. fc köln") == ["Jahmai Simpson-Pusey"])
    }

    @Test func aWordStartsAWordOrFromFourLettersSitsInsideOne() {
        // "bach" sits inside "gladbach"; three letters must start a word.
        #expect(names("bach") == ["Tim Kleindienst"])
        #expect(names("ach").isEmpty)
        #expect(names("").isEmpty)
        #expect(names("  ").isEmpty)
    }

    @Test func surnameHitsComeFirst() {
        // A surname hit outranks even a starter found by his first name.
        let list = [entry(1, "Leon Goretzka", "FC Bayern München"), entry(2, "Marc Leonhardt", "SC Freiburg", rank: 2),
                    entry(3, "Bernd Leno", "SC Freiburg", rank: 1)]
        #expect(ScoutSearch.search(list, "leon").hits.map(\.name) == ["Marc Leonhardt", "Leon Goretzka"])
        // Without a surname hit: starters, alternatives, the rest; then by name.
        #expect(ScoutSearch.search(list, "freiburg").hits.map(\.name) == ["Bernd Leno", "Marc Leonhardt"])
    }

    @Test func fortyHitsAndHowManyMore() {
        let many = (1...45).map { entry($0, "Spieler Nummer\($0)", "SC Freiburg") }
        let found = ScoutSearch.search(many, "spieler")
        #expect(found.hits.count == 40)
        #expect(found.more == 5)
        #expect(ScoutSearch.search(many, "nummer7").more == 0)
    }

    @Test func foldsLettersWithoutAnAccentToDrop() {
        #expect(fold("Đurić") == "duric")
        #expect(fold("Møller") == "moller")
        #expect(fold("Weiß") == "weiss")
        #expect(fold("Vidović") == "vidovic")
    }

    // MARK: the scout list

    private let now = Date(timeIntervalSince1970: 1_800_000_000)
    private func ago(_ hours: Double) -> Date { now.addingTimeInterval(-hours * 3600) }

    @Test func unreadFirstThenTheNewestNews() {
        let list = [entry(1, "A", "X", news: [ago(1)]), entry(2, "B", "X"), entry(3, "C", "X", news: [ago(30)]), entry(4, "D", "X", news: [ago(5)])]
        #expect(ScoutList.sorted(list, fresh: [], now: now).map(\.id) == [1, 4, 3, 2])
        #expect(ScoutList.sorted(list, fresh: [3], now: now).map(\.id) == [3, 1, 4, 2])
    }

    @Test func aPostScheduledForLaterIsNotHisLatestNewsYet() {
        let p = entry(1, "A", "X", news: [now.addingTimeInterval(3600), ago(2)])
        #expect(p.latestNews(now: now)?.at == ago(2))
    }

    @Test func suggestsSixPlayersWithTheNewestNewsOnePerClub() {
        var list = (1...8).map { entry($0, "P\($0)", "Club \($0)", news: [ago(Double($0))]) }
        // A second player of club 1 with even newer news than its first, one without news, one whose news isn't out.
        list.append(entry(9, "P9", "Club 1", news: [ago(0.5)]))
        list.append(entry(10, "P10", "Club 10"))
        list.append(entry(11, "P11", "Club 11", news: [now.addingTimeInterval(60)]))
        #expect(ScoutList.suggestions(list, now: now).map(\.id) == [9, 2, 3, 4, 5, 6])
    }

    @Test func aNewsItemsTimeIsRelativeWithinADay() {
        #expect(Berlin.when(ago(3), now: now) == "vor 3 Std.")
        #expect(Berlin.when(ago(0.2), now: now) == "vor 12 Min.")
        #expect(Berlin.when(ago(23.9), now: now) == "vor 23 Std.")
        // From a day on: the day, as the website writes it.
        #expect(Berlin.when(ago(24), now: now) == Berlin.shortDay(ago(24)))
        #expect(Berlin.when(ago(100), now: now) == Berlin.shortDay(ago(100)))
    }

    @Test func aPlayerFoundByTheSearchLeadsToHisClub() throws {
        let feed = try AppFeed.decode(try fixture("app-feed"))
        let players = feed.allPlayers()
        #expect(!players.isEmpty)
        #expect(players.allSatisfy { $0.card.clubSlug == feed.lineups.first?.club.slug })
        #expect(ScoutSearch.search(players, "kimmich fcb").hits.map(\.name) == ["Joshua Kimmich"])
    }
}
