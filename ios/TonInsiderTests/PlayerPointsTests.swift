import Foundation
import Testing
@testable import TonInsider

extension NetworkTests {
    /// The card's "Punkte am Spieltag" (PlayerCard.astro fillBreakdown, GET /api/kickbase/player/<id>/).
    @Suite(.serialized) @MainActor
    struct PlayerPointsTests {
        private let answer = #"{"live":{"state":1,"points":136,"minute":71},"lines":[{"name":"Parade","count":4,"points":48},{"name":"Gegentor","count":1,"points":-30}]}"#
        private let over = #"{"live":{"state":2,"points":136},"lines":[{"name":"Parade","count":4,"points":48}]}"#
        private let start = Date(timeIntervalSince1970: 1_800_000_000)

        private func breakdown(_ body: String, calls: Locked<Int>) -> PointsBreakdown {
            StubProtocol.handler = { _ in calls.value += 1; return (response(200), Data(body.utf8)) }
            return PointsBreakdown(api: API(session: StubProtocol.session(), tokens: MemoryTokenStore()))
        }

        @Test func decodesTheAnswer() throws {
            let p = try JSONDecoder.site.decode(PlayerPoints.self, from: Data(answer.utf8))
            #expect(p.live.state == 1)
            #expect(p.live.points == 136)
            #expect(p.lines.map(\.name) == ["Parade", "Gegentor"])
            #expect(p.lines.last?.points == -30)
        }

        @Test func asksOnceWithinHalfAMinuteWhileHisMatchRuns() async throws {
            let calls = Locked(0)
            let b = breakdown(answer, calls: calls)
            _ = try await b.load("1873", now: start)
            _ = try await b.load("1873", now: start.addingTimeInterval(20))
            #expect(calls.value == 1)
            _ = try await b.load("1873", now: start.addingTimeInterval(31))
            #expect(calls.value == 2)
        }

        @Test func keepsItTenMinutesOnceHisMatchIsOver() async throws {
            let calls = Locked(0)
            let b = breakdown(over, calls: calls)
            _ = try await b.load("1873", now: start)
            _ = try await b.load("1873", now: start.addingTimeInterval(9 * 60))
            #expect(calls.value == 1)
            _ = try await b.load("1873", now: start.addingTimeInterval(10 * 60 + 1))
            #expect(calls.value == 2)
        }

        @Test func aFailedLoadThrows() async {
            StubProtocol.handler = { _ in (response(502), Data(#"{"error":"Kickbase ist gerade nicht erreichbar."}"#.utf8)) }
            let b = PointsBreakdown(api: API(session: StubProtocol.session(), tokens: MemoryTokenStore()))
            await #expect(throws: (any Error).self) { try await b.load("1873") }
        }

        @Test func sixLinesFirstTheRestOnTap() {
            let lines = (1...8).map { PlayerPoints.Line(name: "A\($0)", count: 1, points: $0) }
            #expect(PointsBreakdown.visible(lines, all: false).shown.count == 6)
            #expect(PointsBreakdown.visible(lines, all: false).hidden == 2)
            #expect(PointsBreakdown.visible(lines, all: true).shown.count == 8)
            #expect(PointsBreakdown.visible(lines, all: true).hidden == 0)
            #expect(PointsBreakdown.visible(Array(lines.prefix(4)), all: false).hidden == 0)
        }

        @Test func actionColours() {
            #expect([-3, 0, 19, 20].map(PointsTier.action) == [.neg, .mid, .mid, .high])
        }
    }
}
