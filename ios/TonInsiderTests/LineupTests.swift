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
