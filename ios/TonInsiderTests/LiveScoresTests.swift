import Foundation
import Testing
@testable import TonInsider

/// The live score on a match card (Base.astro's window.__applyLive, src/lib/live.ts, src/lib/liveClient.ts).
@MainActor
struct LiveScoreRulesTests {
    private let kickoff = Date(timeIntervalSince1970: 1_800_000_000)
    private func after(_ minutes: Double) -> Date { kickoff.addingTimeInterval(minutes * 60) }

    private var fixture: Fixture {
        Fixture(home: "borussia-dortmund", away: "sv-werder-bremen", homeName: "Borussia Dortmund", awayName: "SV Werder Bremen", kickoff: kickoff)
    }
    private func score(_ home: Int, _ away: Int, finished: Bool = false) -> LiveScore {
        LiveScore(home: "borussia-dortmund", away: "sv-werder-bremen", score: [home, away], finished: finished)
    }
    private func goal(_ home: Int, _ away: Int, _ minute: Int?, _ name: String, penalty: Bool = false, own: Bool = false) -> LiveGoal {
        LiveGoal(minute: minute, name: name, home: home, away: away, penalty: penalty, own: own)
    }

    @Test func nothingBeforeKickoffOrWithoutAScore() {
        #expect(LiveState(fixture, scores: [score(0, 0)], matches: [], now: after(-1)) == nil)
        // "- : -" in LigaInsider's match bar: the game is listed, but hasn't a score yet.
        let listed = LiveScore(home: "borussia-dortmund", away: "sv-werder-bremen", score: nil, finished: false)
        #expect(LiveState(fixture, scores: [listed], matches: [], now: after(5)) == nil)
        #expect(LiveState(fixture, scores: [], matches: [], now: after(5)) == nil)
        // Another game's score isn't this one's (nor the return match's).
        let other = LiveScore(home: "sv-werder-bremen", away: "borussia-dortmund", score: [1, 0], finished: false)
        #expect(LiveState(fixture, scores: [other], matches: [], now: after(5)) == nil)
        var noKickoff = fixture
        noKickoff.kickoff = nil
        #expect(LiveState(noKickoff, scores: [score(1, 0)], matches: [], now: after(5)) == nil)
    }

    @Test func showsTheScoreFromKickoffOn() {
        let state = LiveState(fixture, scores: [score(2, 1)], matches: [], now: after(30))
        #expect(state?.home == 2 && state?.away == 1)
        #expect(state?.finished == false)
        #expect(state?.goals.isEmpty == true)
    }

    /// LigaInsider's "Noten" link isn't proof a game is over: never before 1 h 45 min (90 minutes and the break).
    @Test func neverOverBeforeOneHourFortyFive() {
        #expect(LiveState(fixture, scores: [score(2, 1, finished: true)], matches: [], now: after(60))?.finished == false)
        #expect(LiveState(fixture, scores: [score(2, 1, finished: true)], matches: [], now: after(105))?.finished == false)
        #expect(LiveState(fixture, scores: [score(2, 1, finished: true)], matches: [], now: after(106))?.finished == true)
    }

    /// Whatever the sources say: over at the latest 2 h 10 min after kickoff.
    @Test func overAtTheLatestAfterTwoHoursTen() {
        #expect(LiveState(fixture, scores: [score(2, 1)], matches: [], now: after(129))?.finished == false)
        #expect(LiveState(fixture, scores: [score(2, 1)], matches: [], now: after(130))?.finished == false)
        #expect(LiveState(fixture, scores: [score(2, 1)], matches: [], now: after(131))?.finished == true)
    }

    /// OpenLigaDB's own scores were wrong too often: it only adds the scorers when its score agrees.
    @Test func scorersOnlyWhenOpenLigaAgrees() {
        let goals = [goal(1, 0, 12, "S. Guirassy"), goal(1, 1, 30, "J. Stage")]
        let match = LiveMatch(home: " borussia dortmund", away: "SV Werder Bremen ", finished: false, score: [1, 1], goals: goals)
        #expect(LiveState(fixture, scores: [score(1, 1)], matches: [match], now: after(40))?.goals == goals)
        #expect(LiveState(fixture, scores: [score(2, 1)], matches: [match], now: after(40))?.goals.isEmpty == true)
        var elsewhere = match
        elsewhere.home = "FC Bayern München"
        #expect(LiveState(fixture, scores: [score(1, 1)], matches: [elsewhere], now: after(40))?.goals.isEmpty == true)
    }

    /// Two columns, home left and away right, in the order they fell.
    @Test func scorersBySide() {
        let goals = [goal(1, 0, 12, "S. Guirassy"), goal(1, 1, 30, "J. Stage", penalty: true), goal(2, 1, nil, "M. Friedl", own: true)]
        let state = LiveState(home: 2, away: 1, finished: false, goals: goals)
        #expect(state.scorers.home == ["12' S. Guirassy", "M. Friedl (ET)"])
        #expect(state.scorers.away == ["30' J. Stage (11m)"])
    }

    @Test func readsOpenLigaDB() throws {
        let json = """
        [{"matchDateTimeUTC":"2026-10-09T18:30:00Z","team1":{"teamName":"Borussia Dortmund"},"team2":{"teamName":"SV Werder Bremen"},
          "matchIsFinished":false,"matchResults":[],
          "goals":[{"scoreTeam1":1,"scoreTeam2":0,"matchMinute":12,"goalGetterName":"S. Guirassy","isPenalty":false,"isOwnGoal":false},
                   {"scoreTeam1":1,"scoreTeam2":1,"matchMinute":null,"goalGetterName":"J. Stage","isPenalty":true,"isOwnGoal":false}]},
         {"matchDateTimeUTC":"2026-10-09T18:30:00Z","team1":{"teamName":"A"},"team2":{"teamName":"B"},"matchIsFinished":true,
          "matchResults":[{"resultOrderID":1,"pointsTeam1":1,"pointsTeam2":0},{"resultOrderID":2,"pointsTeam1":2,"pointsTeam2":0}],
          "goals":[{"scoreTeam1":1,"scoreTeam2":0,"matchMinute":12,"goalGetterName":"X","isPenalty":false,"isOwnGoal":false}]},
         {"matchDateTimeUTC":"2026-10-09T18:30:00Z","team1":{"teamName":"C"},"team2":{"teamName":"D"},"matchIsFinished":false,"matchResults":[],"goals":[]},
         {}]
        """
        let matches = LiveMatch.parse(Data(json.utf8))
        #expect(matches.count == 3)
        // The score is the latest goal …
        #expect(matches[0].score == [1, 1])
        #expect(matches[0].goals[1] == LiveGoal(minute: nil, name: "J. Stage", home: 1, away: 1, penalty: true, own: false))
        // … or the final result when goals are missing, else 0:0.
        #expect(matches[1].score == [2, 0] && matches[1].finished)
        #expect(matches[2].score == [0, 0] && matches[2].goals.isEmpty)
        // Anything that isn't a match list is ignored.
        #expect(LiveMatch.parse(Data(#"{"error":1}"#.utf8)).isEmpty)
        #expect(LiveMatch.parse(Data("oops".utf8)).isEmpty)
    }

    // When to ask (liveClient.ts tick): only while one of the matchday's games runs (from kickoff for 3 h), every
    // 30 s; between and after the games once, for the final scores of those that ended since the last answer.

    @Test func nothingIsAskedBeforeTheFirstKickoff() {
        let plan = LivePoll.plan(kickoffs: [kickoff, after(120)], now: after(-10), lastAt: nil)
        #expect(!plan.fetch)
        // It waits for the kickoff.
        #expect(plan.next == 600)
    }

    @Test func asksEveryThirtySecondsWhileAGameRuns() {
        #expect(LivePoll.plan(kickoffs: [kickoff], now: after(10), lastAt: nil) == LivePoll.Plan(fetch: true, next: 30))
        // An answer younger than 25 s is fresh enough (another page asked just now).
        #expect(LivePoll.plan(kickoffs: [kickoff], now: after(10), lastAt: after(10).addingTimeInterval(-10)) == LivePoll.Plan(fetch: false, next: 30))
        #expect(LivePoll.plan(kickoffs: [kickoff], now: after(10), lastAt: after(10).addingTimeInterval(-26)) == LivePoll.Plan(fetch: true, next: 30))
        // A game counts as running for 3 h.
        #expect(LivePoll.plan(kickoffs: [kickoff], now: after(179), lastAt: after(178)).next == 30)
    }

    @Test func oneLookForTheFinalScoresThenItStops() {
        // The last answer is from while it ran: once more for the final score.
        #expect(LivePoll.plan(kickoffs: [kickoff], now: after(200), lastAt: after(170)) == LivePoll.Plan(fetch: true, next: nil))
        #expect(LivePoll.plan(kickoffs: [kickoff], now: after(200), lastAt: nil) == LivePoll.Plan(fetch: true, next: nil))
        // It has the final scores: nothing more.
        #expect(LivePoll.plan(kickoffs: [kickoff], now: after(200), lastAt: after(190)) == LivePoll.Plan(fetch: false, next: nil))
    }

    @Test func betweenTwoGamesItWaitsForTheNextKickoff() {
        let sunday = after(24 * 60)
        let plan = LivePoll.plan(kickoffs: [kickoff, sunday], now: after(300), lastAt: after(190))
        #expect(plan == LivePoll.Plan(fetch: false, next: (24 * 60 - 300) * 60))
        #expect(LivePoll.plan(kickoffs: [], now: kickoff, lastAt: nil) == LivePoll.Plan(fetch: false, next: nil))
    }
}

extension NetworkTests {
    @Suite(.serialized) @MainActor
    struct LiveScoresModelTests {
        private let kickoff = Date(timeIntervalSince1970: 1_800_000_000)
        private let scores = Data(#"[{"home":"a","away":"b","score":[2,1],"finished":false},{"home":"c","away":"d","finished":false}]"#.utf8)
        private let openLiga = Data("""
        [{"matchDateTimeUTC":"2026-10-09T18:30:00Z","team1":{"teamName":"A"},"team2":{"teamName":"B"},"matchIsFinished":false,"matchResults":[],
          "goals":[{"scoreTeam1":1,"scoreTeam2":0,"matchMinute":12,"goalGetterName":"X","isPenalty":false,"isOwnGoal":false}]}]
        """.utf8)

        private func defaults() -> UserDefaults {
            let name = "live-\(UUID().uuidString)"
            let d = UserDefaults(suiteName: name)!
            d.removePersistentDomain(forName: name)
            return d
        }

        private func model(_ defaults: UserDefaults) -> LiveScoresModel {
            LiveScoresModel(api: API(session: StubProtocol.session(), tokens: MemoryTokenStore("T1")), session: StubProtocol.session(),
                            defaults: defaults, interval: .milliseconds(5))
        }

        @Test func asksBothSourcesAndKeepsTheAnswer() async throws {
            let seen = Box<[URLRequest]>([])
            let scores = scores, openLiga = openLiga
            StubProtocol.handler = { request in
                seen.value.append(request)
                return (response(200), request.url?.host == "api.openligadb.de" ? openLiga : scores)
            }
            let store = defaults()
            let model = model(store)
            // The game is over (3 h 20 min after kickoff): one look for the final score, then it stops by itself.
            await model.run(kickoffs: [kickoff], now: { self.kickoff.addingTimeInterval(200 * 60) })
            #expect(model.scores.count == 2 && model.scores[0].score == [2, 1])
            #expect(model.matches.first?.goals.first?.name == "X")
            #expect(seen.value.count == 2)
            let site = seen.value.first { $0.url?.path() == "/api/live/" }
            #expect(site?.value(forHTTPHeaderField: "X-TonInsider-App") == "1")
            // OpenLigaDB is someone else's: it gets neither the app's header nor the session.
            let other = seen.value.first { $0.url?.host == "api.openligadb.de" }
            #expect(other?.url?.absoluteString == "https://api.openligadb.de/getmatchdata/bl1")
            #expect(other?.value(forHTTPHeaderField: "Authorization") == nil)
            #expect(other?.value(forHTTPHeaderField: "X-TonInsider-App") == nil)

            // The next start draws the last answer at once, and asks nothing more: the final scores are in.
            StubProtocol.handler = { _ in throw URLError(.timedOut) }
            seen.value = []
            let again = self.model(store)
            #expect(again.scores.first?.score == [2, 1])
            #expect(again.matches.count == 1)
            await again.run(kickoffs: [kickoff], now: { self.kickoff.addingTimeInterval(201 * 60) })
            #expect(seen.value.isEmpty)
        }

        @Test func asksAgainAndAgainWhileAGameRuns() async throws {
            let calls = Locked(0)
            let scores = scores
            StubProtocol.handler = { request in
                if request.url?.host == "api.openligadb.de" { throw URLError(.timedOut) }
                calls.value += 1
                return (response(200), scores)
            }
            let model = model(defaults())
            // The clock runs a minute per look, so no answer is ever fresh enough to skip one.
            let clock = Locked(kickoff.addingTimeInterval(600))
            let run = Task { await model.run(kickoffs: [self.kickoff], now: { clock.value = clock.value.addingTimeInterval(60); return clock.value }) }
            while calls.value < 3 { try await Task.sleep(for: .milliseconds(5)) }
            run.cancel()
            // One source down: the other's answer counts.
            #expect(model.scores.count == 2)
            #expect(model.matches.isEmpty)
        }

        /// Both sources down, or an empty list: the cards keep what they show.
        @Test func aFailedOrEmptyAnswerKeepsTheScores() async throws {
            let scores = scores, openLiga = openLiga
            StubProtocol.handler = { request in (response(200), request.url?.host == "api.openligadb.de" ? openLiga : scores) }
            let model = model(defaults())
            await model.run(kickoffs: [kickoff], now: { self.kickoff.addingTimeInterval(200 * 60) })
            let first = model.at
            #expect(first != nil)

            StubProtocol.handler = { request in
                if request.url?.host == "api.openligadb.de" { throw URLError(.timedOut) }
                return (response(502), Data(#"{"error":"unavailable"}"#.utf8))
            }
            // A later game has ended since: it looks again, and gets nothing.
            let later = kickoff.addingTimeInterval(86_400)
            await model.run(kickoffs: [kickoff, later], now: { later.addingTimeInterval(200 * 60) })
            #expect(model.scores.first?.score == [2, 1])
            #expect(model.matches.count == 1)
            #expect(model.at == first)

            StubProtocol.handler = { request in
                if request.url?.host == "api.openligadb.de" { throw URLError(.timedOut) }
                return (response(200), Data("[]".utf8))
            }
            await model.run(kickoffs: [kickoff, later], now: { later.addingTimeInterval(200 * 60) })
            #expect(model.scores.first?.score == [2, 1])
            #expect(model.matches.count == 1)
        }

        @Test func nothingIsAskedBeforeKickoff() async throws {
            let calls = Locked(0)
            StubProtocol.handler = { _ in calls.value += 1; return (response(200), Data("[]".utf8)) }
            let model = model(defaults())
            let run = Task { await model.run(kickoffs: [self.kickoff], now: { self.kickoff.addingTimeInterval(-3_600) }) }
            try await Task.sleep(for: .milliseconds(40))
            run.cancel()
            #expect(calls.value == 0)
        }
    }
}
