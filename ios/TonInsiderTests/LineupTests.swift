import Foundation
import Testing
@testable import TonInsider

@MainActor
struct LineupTests {
    private func feed() throws -> AppFeed { try AppFeed.decode(try fixture("app-feed")) }

    @Test func decodesFixturesWithOdds() throws {
        let f = try feed().fixtures[0]
        #expect(f.home == "fc-bayern-muenchen" && f.away == nil)
        #expect(f.chances?.home == 78 && f.tip?.home == 2 && f.cleanSheet?.home == 55)
        #expect(try feed().insights["3"]?.scorer == 30)
    }

    /// "Wahrscheinlichstes Ergebnis 2:0 (14 %)": the percent came later, a feed stored before it still reads.
    @Test func theLikelyScoreCarriesItsPercent() throws {
        #expect(try feed().fixtures[0].tip?.percent == 14)
        let old = try JSONDecoder.site.decode(Fixture.self, from: Data(#"{"homeName":"A","awayName":"B","tip":{"home":2,"away":0}}"#.utf8))
        #expect(old.tip?.home == 2 && old.tip?.percent == nil)
        #expect(ChancesBar.likelihood(Fixture.Score(home: 2, away: 0, percent: 14)) == " (14\u{a0}%)")
        #expect(ChancesBar.likelihood(Fixture.Score(home: 2, away: 0)) == "")
    }

    /// The newspaper on a pitch photo (card.ts hasFreshNews): news from the last 3 days, and only those that are out.
    @Test func playersWithFreshNews() throws {
        let feed = try feed()
        // Player 1's from 1 Nov 23:30 and player 3's from 2 Nov 10:00; nothing was out three days earlier.
        #expect(feed.freshNewsPlayers(now: berlinNow) == [1, 3])
        #expect(feed.freshNewsPlayers(now: berlinNow.addingTimeInterval(1.9 * 86_400)) == [3])
        #expect(feed.freshNewsPlayers(now: berlinNow.addingTimeInterval(4 * 86_400)).isEmpty)
        #expect(feed.freshNewsPlayers(now: berlinNow.addingTimeInterval(-3 * 86_400)).isEmpty)
    }

    /// Under a club's pitch (Pitch.astro): the dots until the XI is confirmed, the newspaper only when someone has news.
    @Test func theClubPitchsLegend() throws {
        let bayern = try feed().lineups[0]
        #expect(LineupPitch.legend(bayern, confirmed: false, fresh: []).map(\.text) == ["Gesetzt", "Fraglich", "Tippen für Prognose"])
        #expect(LineupPitch.legend(bayern, confirmed: true, fresh: [99]).map(\.text) == ["Startelf bestätigt", "Tippen für Prognose"])
        // Player 4 is an alternative: his news count too.
        let withNews = LineupPitch.legend(bayern, confirmed: false, fresh: [4])
        #expect(withNews.map(\.text) == ["Gesetzt", "Fraglich", "Neue News", "Tippen für Prognose"])
        #expect(withNews.map(\.mark) == [.dot(.green), .dot(.yellow), .news, nil])
    }

    /// Under a match report's pitch (RatingsPitch.astro): only the marks that pitch shows.
    @Test func theGradesPitchsLegend() {
        func player(_ marks: [RatingMark]) -> RatedPlayer { RatedPlayer(id: 1, slug: "a", name: "A", photo: nil, grade: 3, marks: marks) }
        let plain = TeamRatings(team: "A", crest: nil, average: nil, lines: [[RatedSpot(player: player([.ownGoal, .error]), sub: nil, minute: nil)]])
        #expect(RatingsPitch.legend(plain).map(\.text) == ["Note 1 (top) bis 6"])
        let full = TeamRatings(team: "A", crest: nil, average: nil, lines: [[
            RatedSpot(player: player([.goal]), sub: player([.yellowRed]), minute: 60), RatedSpot(player: player([.assist]), sub: nil, minute: nil),
        ]])
        #expect(RatingsPitch.legend(full).map(\.text) == ["Note 1 (top) bis 6", "Tor", "Vorlage", "Karte", "⇄ Einwechslung"])
    }

    /// A substitute's bar is filled from his minute to the end (.sub-played's --from): never quite empty.
    @Test func aSubstitutesTimeOnThePitch() {
        #expect(SubsList.playedFrom(minute: 45) == 0.5)
        #expect(SubsList.playedFrom(minute: 0) == 0)
        #expect(SubsList.playedFrom(minute: -3) == 0)
        #expect(SubsList.playedFrom(minute: 90) == 0.98)
        #expect(SubsList.playedFrom(minute: 97) == 0.98)
    }

    /// An alternative's card says so in the website's words (Pitch.astro).
    @Test func anAlternativesStatus() throws {
        let p = try feed().lineups[0].lines[1][0]
        #expect(p.alternativeStatus == "Alternative zu \(p.name)")
    }

    @Test func clubNewsLeavesOutThePitchAndOlderThanAWeek() throws {
        let feed = try feed()
        let bayern = feed.lineups[0]
        // Kimmich (on the pitch) and the article from 20 Oct (older than 7 days) are left out.
        #expect(feed.clubNews(bayern, now: berlinNow).map(\.id) == [420100])
    }

    @Test func lineupCommentsThread() throws {
        #expect(try feed().lineups[0].threadKey == "t185708-5ju4n8wsoc85fnut62uav3i8k-14")
    }

    @Test func startStatusOfAPredictedStarter() throws {
        let lines = try feed().lineups[0].lines
        #expect(lines[0][0].start(confirmed: false) == ("Startelf", Tone.green))
        #expect(lines[1][0].start(confirmed: false) == ("Fraglich · Wade", Tone.yellow))
        #expect(lines[1][0].start(confirmed: true) == ("S11", Tone.green))
    }

    @Test func newsOfAPlayer() throws {
        #expect(try feed().newsOf(player: 3).map(\.id) == [420050])
    }
}
