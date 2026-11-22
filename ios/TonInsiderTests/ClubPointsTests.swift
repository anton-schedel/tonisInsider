import Foundation
import Testing
@testable import TonInsider

extension NetworkTests {
    /// The club page's live points (src/pages/vereine/[slug].astro, GET /api/kickbase/club/<slug>/).
    @Suite(.serialized) @MainActor
    struct ClubPointsTests {
        private let kickoff = Date(timeIntervalSince1970: 1_800_000_000)

        @Test func decodesTheAnswer() throws {
            let p = try JSONDecoder.site.decode(ClubPoints.self, from: try fixture("club-points"))
            #expect(p.live.state == 1)
            #expect(p.players["10454"] == 162)
            #expect(p.ids?["9357"] == "1873")
            #expect(p.slots?["10454"]?.sub?.name == "Silva")
            #expect(p.subs?.map(\.name) == ["Silva", "Adeyemi"])
            #expect(p.subs?.first?.out == "Guirassy")
            #expect(p.subs?.last?.points == nil)
        }

        @Test func pointsMatterFromKickoffForFourDays() {
            #expect(!ClubPointsModel.matters(kickoff: nil, now: kickoff))
            #expect(!ClubPointsModel.matters(kickoff: kickoff, now: kickoff.addingTimeInterval(-60)))
            #expect(ClubPointsModel.matters(kickoff: kickoff, now: kickoff))
            #expect(ClubPointsModel.matters(kickoff: kickoff, now: kickoff.addingTimeInterval(4 * 86_400 - 3_600)))
            #expect(!ClubPointsModel.matters(kickoff: kickoff, now: kickoff.addingTimeInterval(4 * 86_400)))
        }

        @Test func aSlotShowsWhoReallyPlayed() {
            let alt = PlayerRef(id: 2, slug: "b", name: "Jobe", photo: nil)
            let p = LineupPlayer(id: 1, slug: "a", name: "Nmecha", photo: nil, status: .set, statusLabel: nil, alternative: alt)
            #expect(LineupPitch.played(p, ClubPoints.SlotPlay(show: "alt", sub: nil)).shown == alt)
            #expect(LineupPitch.played(p, ClubPoints.SlotPlay(show: "alt", sub: nil)).note == nil)
            let subbed = LineupPitch.played(p, ClubPoints.SlotPlay(show: "main", sub: .init(kb: "9", name: "Beier", photo: nil, minute: 63, points: nil)))
            #expect(subbed.shown.id == 1)
            #expect(subbed.note == "bis 63' · Beier")
            #expect(LineupPitch.played(p, nil).shown.id == 1)
            #expect(LineupPitch.played(p, nil).note == nil)
        }

        @Test func stopsAskingOnceTheMatchIsOver() async throws {
            let calls = Locked(0)
            StubProtocol.handler = { _ in
                calls.value += 1
                return (response(200), Data(#"{"live":{"state":2},"players":{"1":40}}"#.utf8))
            }
            let model = ClubPointsModel(api: API(session: StubProtocol.session(), tokens: MemoryTokenStore()), interval: .milliseconds(5))
            await model.run(slug: "fcb", kickoff: kickoff, now: { self.kickoff.addingTimeInterval(7_200) })
            #expect(calls.value == 1)
            #expect(model.points?.players["1"] == 40)
        }

        @Test func keepsTheLastPointsWhenKickbaseFails() async throws {
            let calls = Locked(0)
            StubProtocol.handler = { _ in
                calls.value += 1
                if calls.value > 1 { throw URLError(.timedOut) }
                return (response(200), Data(#"{"live":{"state":1},"players":{"1":12}}"#.utf8))
            }
            let model = ClubPointsModel(api: API(session: StubProtocol.session(), tokens: MemoryTokenStore()), interval: .milliseconds(5))
            let run = Task { await model.run(slug: "fcb2", kickoff: kickoff, now: { self.kickoff.addingTimeInterval(600) }) }
            while calls.value < 3 { try await Task.sleep(for: .milliseconds(5)) }
            run.cancel()
            #expect(model.points?.players["1"] == 12)
        }

        /// A club Kickbase can't be asked for (503 unmapped, 502 Kickbase down, 404 unknown): no placeholders that
        /// never fill; it keeps asking quietly, and the points show once an answer comes.
        @Test func aFailedFirstAnswerIsKnownAndItKeepsAsking() async throws {
            let calls = Locked(0)
            StubProtocol.handler = { _ in
                calls.value += 1
                if calls.value < 3 { return (response(503), Data(#"{"error":"unavailable"}"#.utf8)) }
                return (response(200), Data(#"{"live":{"state":1},"players":{"1":12}}"#.utf8))
            }
            let model = ClubPointsModel(api: API(session: StubProtocol.session(), tokens: MemoryTokenStore()), interval: .milliseconds(40))
            #expect(!model.failed)
            let run = Task { await model.run(slug: "fcb6", kickoff: kickoff, now: { self.kickoff.addingTimeInterval(600) }) }
            while calls.value < 1 { try await Task.sleep(for: .milliseconds(2)) }
            try await Task.sleep(for: .milliseconds(15))
            #expect(model.failed)
            #expect(model.points == nil)
            while model.points == nil { try await Task.sleep(for: .milliseconds(5)) }
            run.cancel()
            #expect(!model.failed)
            #expect(model.points?.players["1"] == 12)
        }

        /// With points on the page, a failed look isn't a failure to show: they stay.
        @Test func aFailedLookWithPointsShownIsNoFailure() async throws {
            let calls = Locked(0)
            StubProtocol.handler = { _ in
                calls.value += 1
                if calls.value > 1 { throw URLError(.timedOut) }
                return (response(200), Data(#"{"live":{"state":1},"players":{"1":12}}"#.utf8))
            }
            let model = ClubPointsModel(api: API(session: StubProtocol.session(), tokens: MemoryTokenStore()), interval: .milliseconds(5))
            let run = Task { await model.run(slug: "fcb7", kickoff: kickoff, now: { self.kickoff.addingTimeInterval(600) }) }
            while calls.value < 3 { try await Task.sleep(for: .milliseconds(5)) }
            run.cancel()
            #expect(!model.failed)
            #expect(model.points?.players["1"] == 12)
        }

        /// The page was open without a kickoff (or with another): when the feed brings one, asking starts, and the
        /// other match's points and failure are gone.
        @Test func aKickoffThatComesLaterStartsTheAsking() async throws {
            let calls = Locked(0)
            StubProtocol.handler = { _ in calls.value += 1; return (response(200), Data(#"{"live":{"state":2},"players":{"1":7}}"#.utf8)) }
            let model = ClubPointsModel(api: API(session: StubProtocol.session(), tokens: MemoryTokenStore()), interval: .milliseconds(5))
            await model.run(slug: "fcb8", kickoff: nil, now: { self.kickoff.addingTimeInterval(600) })
            #expect(calls.value == 0)
            await model.run(slug: "fcb8", kickoff: kickoff, now: { self.kickoff.addingTimeInterval(600) })
            #expect(calls.value == 1)
            #expect(model.points?.players["1"] == 7)

            // The match was moved: its points aren't the new date's.
            let moved = kickoff.addingTimeInterval(86_400)
            StubProtocol.handler = { _ in calls.value += 1; return (response(502), Data(#"{"error":"unavailable"}"#.utf8)) }
            let run = Task { await model.run(slug: "fcb8", kickoff: moved, now: { moved.addingTimeInterval(600) }) }
            while calls.value < 2 { try await Task.sleep(for: .milliseconds(2)) }
            try await Task.sleep(for: .milliseconds(15))
            run.cancel()
            #expect(model.points == nil)
            #expect(model.failed)

            // Its kickoff hasn't come: nothing to show, nothing failed.
            let ahead = Task { await model.run(slug: "fcb8", kickoff: moved, now: { moved.addingTimeInterval(-600) }) }
            try await Task.sleep(for: .milliseconds(20))
            ahead.cancel()
            #expect(!model.failed)
        }

        /// What the club page asks with: the app in front, and the kickoff the feed has now.
        @Test func thePageAsksAnewWhenTheKickoffChanges() {
            #expect(ClubPointsModel.Asking(active: true, kickoff: nil) != ClubPointsModel.Asking(active: true, kickoff: kickoff))
            #expect(ClubPointsModel.Asking(active: true, kickoff: kickoff) != ClubPointsModel.Asking(active: true, kickoff: kickoff.addingTimeInterval(3_600)))
            #expect(ClubPointsModel.Asking(active: true, kickoff: kickoff) != ClubPointsModel.Asking(active: false, kickoff: kickoff))
        }

        @Test func noRequestOnceTheMatchdayIsOver() async throws {
            let calls = Locked(0)
            StubProtocol.handler = { _ in calls.value += 1; return (response(200), Data("{}".utf8)) }
            let model = ClubPointsModel(api: API(session: StubProtocol.session(), tokens: MemoryTokenStore()), interval: .milliseconds(5))
            await model.run(slug: "fcb3", kickoff: kickoff, now: { self.kickoff.addingTimeInterval(5 * 86_400) })
            #expect(calls.value == 0)
            #expect(model.points == nil)
        }

        /// Opened at 15:25 for a 15:30 kickoff: nothing asked before kickoff, the points come once it's on.
        @Test func aPageOpenBeforeKickoffStartsAskingAtKickoff() async throws {
            let calls = Locked(0)
            StubProtocol.handler = { _ in calls.value += 1; return (response(200), Data(#"{"live":{"state":2},"players":{"1":7}}"#.utf8)) }
            let model = ClubPointsModel(api: API(session: StubProtocol.session(), tokens: MemoryTokenStore()), interval: .milliseconds(5))
            let opened = Date()
            let start = opened.addingTimeInterval(0.15)
            await model.run(slug: "fcb4", kickoff: start, now: { Date() })
            #expect(Date().timeIntervalSince(opened) >= 0.15)
            #expect(calls.value == 1)
            #expect(model.points?.players["1"] == 7)
        }

        /// The app can stay alive for days: last matchday's answer isn't shown for this one.
        @Test func lastAnswerIsOnlyShownForTheSameMatch() async throws {
            StubProtocol.handler = { _ in (response(200), Data(#"{"live":{"state":2},"players":{"1":99}}"#.utf8)) }
            let api = API(session: StubProtocol.session(), tokens: MemoryTokenStore())
            await ClubPointsModel(api: api, interval: .milliseconds(5)).run(slug: "fcb5", kickoff: kickoff, now: { self.kickoff.addingTimeInterval(600) })
            StubProtocol.handler = { _ in throw URLError(.timedOut) }
            let nextWeek = kickoff.addingTimeInterval(7 * 86_400)
            let model = ClubPointsModel(api: api, interval: .milliseconds(5))
            let run = Task { await model.run(slug: "fcb5", kickoff: nextWeek, now: { nextWeek.addingTimeInterval(600) }) }
            try await Task.sleep(for: .milliseconds(40))
            run.cancel()
            #expect(model.points == nil)
            let same = ClubPointsModel(api: api, interval: .milliseconds(5))
            let again = Task { await same.run(slug: "fcb5", kickoff: kickoff, now: { self.kickoff.addingTimeInterval(700) }) }
            try await Task.sleep(for: .milliseconds(40))
            again.cancel()
            #expect(same.points?.players["1"] == 99)
        }
    }
}
