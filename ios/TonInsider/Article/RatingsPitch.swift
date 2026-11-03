import SwiftUI

/// One team's grades from a match report on the pitch (RatingsPitch.astro). A substituted player shows ⇄:
/// tapping him flips to the substitute and back.
struct RatingsPitch: View {
    let team: TeamRatings

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                Crest(url: siteURL(team.crest), size: 32)
                Text(team.team).font(.system(size: 20, weight: .bold)).tracking(-0.4)
                Spacer(minLength: 0)
                if let average = team.average {
                    GradeBadge(grade: average, prefix: "Ø ").font(.system(size: 14, weight: .bold))
                }
            }
            Pitch(lines: team.lines.map { Array($0.indices) }, mirror: true) { i, j in
                RatedSpotView(spot: team.lines[i][j])
            }
        }
        .padding(.top, 32)
    }
}

private struct RatedSpotView: View {
    let spot: RatedSpot
    @State private var showSub = false

    var body: some View {
        let player = showSub ? spot.sub ?? spot.player : spot.player
        let minute = spot.minute.map { "\($0)'" } ?? ""
        let note: String? = spot.sub.map { sub in showSub ? "ab \(minute) · für \(spot.player.name)" : "bis \(minute) · \(sub.name)" }
        PitchFace(photo: siteURL(player.photo), name: player.name, note: note) {
            HStack(spacing: 2) {
                if let grade = player.grade { GradeBadge(grade: grade) } else { GradeBadge(grade: nil) }
                if spot.sub != nil { Text("⇄").font(.system(size: 10, weight: .bold)).foregroundStyle(.white) }
            }
            .font(.system(size: 11, weight: .bold))
        }
        .overlay(alignment: .topLeading) { marks(player).offset(x: 2, y: 0) }
        .contentShape(Rectangle())
        .onTapGesture {
            guard spot.sub != nil else { return }
            withAnimation(.easeInOut(duration: 0.2)) { showSub.toggle() }
        }
    }

    /// Goals and assists, cards (errors aren't shown).
    @ViewBuilder private func marks(_ p: RatedPlayer) -> some View {
        HStack(spacing: 1) {
            ForEach(Array(p.marks.enumerated()), id: \.offset) { _, mark in
                switch mark {
                case .goal: Text("⚽").font(.system(size: 10))
                case .ownGoal: Text("⚽").font(.system(size: 10)).opacity(0.6)
                case .assist: Text("A").font(.system(size: 9, weight: .bold)).foregroundStyle(.white)
                        .frame(width: 13, height: 13).background(Circle().fill(.black.opacity(0.55)))
                case .yellow: card(.yellow)
                case .yellowRed: card(.orange)
                case .red: card(.red)
                case .error: EmptyView()
                }
            }
        }
    }

    private func card(_ color: Color) -> some View {
        RoundedRectangle(cornerRadius: 1.5).fill(color).frame(width: 8, height: 11)
    }
}

/// A grade, 1 (best) to 6, written the German way ("3,5"), coloured from deep green to red (src/lib/grades.ts).
struct GradeBadge: View {
    let grade: Double?
    var prefix = ""

    var body: some View {
        let colors = grade.map(Self.colors) ?? (Color.white.opacity(0.25), Color.white)
        Text(grade.map { prefix + Self.format($0) } ?? "–")
            .monospacedDigit()
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .foregroundStyle(colors.1)
            .background(colors.0, in: Capsule())
    }

    static func format(_ g: Double) -> String {
        g.formatted(.number.precision(.fractionLength(1...2)).locale(Locale(identifier: "de_DE")))
    }

    static func colors(_ g: Double) -> (Color, Color) {
        switch g {
        case ...2: (Color(light: 0x1F9D55, dark: 0x1F9D55), .white)
        case ...3: (Color(light: 0x34C759, dark: 0x34C759), Color(light: 0x06290F, dark: 0x06290F))
        case ...3.5: (Color(light: 0xFFD60A, dark: 0xFFD60A), Color(light: 0x3A2C00, dark: 0x3A2C00))
        case ...4.5: (Color(light: 0xFF9F0A, dark: 0xFF9F0A), Color(light: 0x3A1D00, dark: 0x3A1D00))
        default: (Color(light: 0xFF453A, dark: 0xFF453A), .white)
        }
    }
}
