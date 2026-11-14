import SwiftUI

/// Kickbase's colour steps for points (global.css .pts-*): red below 0, orange up to 99, light green 100–199, a darker
/// green 200–399, gold from 400. `bright` reads on the pitch and in the dark; `ink` on a light background.
enum PointsTier: String, Codable, Hashable, Sendable {
    case neg, low, mid, high, gold

    init?(points: Int?) {
        guard let points else { return nil }
        switch points {
        case ..<0: self = .neg
        case ..<100: self = .low
        case ..<200: self = .mid
        case ..<400: self = .high
        default: self = .gold
        }
    }

    /// A single action in the breakdown (livePoints.ts actionTier): minus red, plus light green, big ones darker green.
    static func action(_ points: Int) -> PointsTier { points < 0 ? .neg : points >= 20 ? .high : .mid }

    var bright: Color {
        switch self {
        case .neg: Color(light: 0xFF453A, dark: 0xFF453A)
        case .low: Color(light: 0xFF9F0A, dark: 0xFF9F0A)
        case .mid: Color(light: 0x9CDD49, dark: 0x9CDD49)
        case .high: Color(light: 0x1FC46F, dark: 0x1FC46F)
        case .gold: Color(light: 0xFFD23F, dark: 0xFFD23F)
        }
    }

    var ink: Color {
        switch self {
        case .neg: Color(light: 0xD70015, dark: 0xFF453A)
        case .low: Color(light: 0xB85C00, dark: 0xFF9F0A)
        case .mid: Color(light: 0x4F8A12, dark: 0x9CDD49)
        case .high: Color(light: 0x0B8A4C, dark: 0x1FC46F)
        case .gold: Color(light: 0xA87800, dark: 0xFFD23F)
        }
    }
}

/// What a points chip shows from kickoff on (livePoints.ts pointsLabel): the points, "0" while his match runs
/// without any, "–" once it's over and he didn't play. Nothing before kickoff.
struct PointsLabel: Codable, Hashable, Sendable {
    var text: String
    var live: Bool
    var tier: PointsTier?

    init(text: String, live: Bool, tier: PointsTier?) {
        self.text = text
        self.live = live
        self.tier = tier
    }

    /// state: 0 not started, 1 running, 2 over.
    init?(state: Int, points: Int?) {
        guard state != 0 else { return nil }
        self.init(text: points.map(String.init) ?? (state == 1 ? "0" : "–"), live: state == 1, tier: PointsTier(points: points))
    }

    /// What VoiceOver says (livePoints.ts pointsAria).
    var spoken: String { "\(text) Kickbase-Punkte\(live ? ", live" : "")" }
}

/// A player's points (KbPoints.astro): on the pitch a dark chip with the number in its colour step, in a row a light
/// one; a dot in the same colour pulses while his match runs. Without a label: a dimmed placeholder where the
/// points will be (so nothing jumps when they come).
struct PointsChip: View {
    enum Style { case pitch, row }

    let label: PointsLabel?
    var style: Style = .pitch

    var body: some View {
        if let label {
            HStack(spacing: 4) {
                if label.live { LiveDot() }
                Text(label.text).monospacedDigit()
            }
            .font(.system(size: style == .pitch ? 11.5 : 14, weight: .bold))
            .foregroundStyle(color(label))
            .padding(.horizontal, style == .pitch ? 7 : 9)
            .padding(.vertical, style == .pitch ? 1 : 2)
            .background(background, in: Capsule())
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(label.spoken)
        } else {
            Capsule().fill(background).frame(width: 34, height: style == .pitch ? 18 : 24).opacity(0.55)
                .accessibilityHidden(true)
        }
    }

    private var background: Color {
        style == .pitch ? Color(light: 0x0A0C10, dark: 0x0A0C10).opacity(0.78) : Color.tiSurface
    }

    private func color(_ label: PointsLabel) -> Color {
        switch style {
        case .pitch: label.tier?.bright ?? .white
        case .row: label.tier?.ink ?? Color.tiForeground
        }
    }
}

/// The 6-point dot of a running match (global.css kb-live): pulses to 30 % and back over 1.6 s, still under reduced
/// motion. Its colour is the surrounding text's, unless given.
struct LiveDot: View {
    var color: Color?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var dim = false

    var body: some View {
        Circle().fill(color.map(AnyShapeStyle.init) ?? AnyShapeStyle(.foreground)).frame(width: 6, height: 6)
            .opacity(dim ? 0.3 : 1)
            .animation(reduceMotion ? nil : .easeInOut(duration: 0.8).repeatForever(autoreverses: true), value: dim)
            .onAppear { if !reduceMotion { dim = true } }
            .accessibilityHidden(true)
    }
}
