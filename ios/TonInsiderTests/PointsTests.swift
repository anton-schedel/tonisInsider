import Testing
@testable import TonInsider

/// The points chip's label and colour step (src/lib/livePoints.ts pointsLabel, pointsTier).
struct PointsTests {
    @Test func noChipBeforeKickoff() {
        #expect(PointsLabel(state: 0, points: nil) == nil)
        #expect(PointsLabel(state: 0, points: 12) == nil)
    }

    @Test func runningShowsPointsOrZero() {
        #expect(PointsLabel(state: 1, points: 31) == PointsLabel(text: "31", live: true, tier: .low))
        #expect(PointsLabel(state: 1, points: nil) == PointsLabel(text: "0", live: true, tier: nil))
    }

    @Test func overShowsPointsOrADash() {
        #expect(PointsLabel(state: 2, points: 245) == PointsLabel(text: "245", live: false, tier: .high))
        #expect(PointsLabel(state: 2, points: nil) == PointsLabel(text: "–", live: false, tier: nil))
    }

    @Test func tiers() {
        #expect([-5, 0, 99, 100, 199, 200, 399, 400].map { PointsTier(points: $0) } == [.neg, .low, .low, .mid, .mid, .high, .high, .gold])
        #expect(PointsTier(points: nil) == nil)
    }

    @Test func spokenLabel() {
        #expect(PointsLabel(text: "31", live: true, tier: .low).spoken == "31 Kickbase-Punkte, live")
        #expect(PointsLabel(text: "–", live: false, tier: nil).spoken == "– Kickbase-Punkte")
    }
}
