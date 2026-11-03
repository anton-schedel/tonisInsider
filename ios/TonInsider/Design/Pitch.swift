import SwiftUI

/// The grass pitch shared by match reports, club lineups and Mein Team (PitchField.astro): mowing stripes and
/// white lines, the same in light and dark mode. Lines of players go from the goalkeeper (bottom) up.
struct Pitch<Face: View>: View {
    /// Lines, goalkeeper's first; each a row of items.
    let lines: [[Int]]
    /// LigaInsider lists each line as seen with the goalkeeper at the top: viewed from our end, left and right swap.
    var mirror = false
    @ViewBuilder let face: (_ line: Int, _ index: Int) -> Face

    /// Photo size on the pitch (src/lib/pitch.ts AVATAR).
    static var photo: CGFloat { 54 }

    var body: some View {
        GeometryReader { geo in
            let size = geo.size
            ZStack(alignment: .topLeading) {
                PitchMarkings()
                ForEach(Array(lines.enumerated()), id: \.offset) { i, line in
                    ForEach(Array(line.indices), id: \.self) { j in
                        let slot = Self.slot(i, rows: lines.count, j, line.count, mirror: mirror)
                        // The photo's centre on the slot's point; the name grows downwards.
                        face(i, j)
                            .frame(width: size.width * slot.width, alignment: .top)
                            .fixedSize(horizontal: false, vertical: true)
                            .offset(x: size.width * (slot.x - slot.width / 2), y: size.height * slot.y - Self.photo / 2)
                    }
                }
            }
        }
        .aspectRatio(4 / 5.2, contentMode: .fit)
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .environment(\.colorScheme, .dark)
    }

    /// Where player j of n in line i (of rows) goes, in fractions of the pitch: the photo's centre, and how wide
    /// his slot may be (src/lib/pitch.ts slotStyle).
    static func slot(_ i: Int, rows: Int, _ j: Int, _ n: Int, mirror: Bool) -> (x: CGFloat, y: CGFloat, width: CGFloat) {
        let top = rows <= 1 ? 50 : 84 - Double(i) * 74 / Double(rows - 1)
        let left = Double((mirror ? n - 1 - j : j) + 1) * 100 / Double(n + 1)
        let width = min(24, 100 / Double(n + 1) - 1)
        return (left / 100, top / 100, width / 100)
    }
}

private struct PitchMarkings: View {
    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width, h = geo.size.height
            let line = Color.white.opacity(0.72)
            ZStack {
                VStack(spacing: 0) {
                    ForEach(0..<10, id: \.self) { i in (i.isMultiple(of: 2) ? Color.tiPitch : Color.tiPitchStripe) }
                }
                RadialGradient(colors: [.clear, .black.opacity(0.18)], center: .center, startRadius: w * 0.45, endRadius: w * 0.9)
                Path { p in
                    p.addRoundedRect(in: CGRect(x: 12, y: 12, width: w - 24, height: h - 24), cornerSize: CGSize(width: 3, height: 3))
                    p.move(to: CGPoint(x: 12, y: h / 2)); p.addLine(to: CGPoint(x: w - 12, y: h / 2))
                    let r = w * 0.11
                    p.addEllipse(in: CGRect(x: w / 2 - r, y: h / 2 - r, width: 2 * r, height: 2 * r))
                    for (bw, bh) in [(0.56, 0.15), (0.26, 0.06)] {
                        p.addRect(CGRect(x: w * (1 - bw) / 2, y: 12, width: w * bw, height: h * bh))
                        p.addRect(CGRect(x: w * (1 - bw) / 2, y: h - 12 - h * bh, width: w * bw, height: h * bh))
                    }
                }
                .stroke(line, lineWidth: 1.5)
                Circle().fill(line).frame(width: 6, height: 6)
            }
        }
    }
}

/// A player on the pitch (PitchFace.astro): photo with a white ring (yellow for an alternative or substitute),
/// its badges each pinned to a corner of the photo, an optional points chip right under it, the name, a short note.
struct PitchFace<Badges: View>: View {
    let photo: URL?
    let name: String
    var note: String?
    var noteColor: Color = .white.opacity(0.7)
    /// An alternative or substitute.
    var alt = false
    /// Kickbase points, from kickoff on ("–" when he didn't play).
    var points: String?
    /// Laid over the photo: place each with .pinned(…).
    @ViewBuilder var badges: Badges

    var body: some View {
        VStack(spacing: 3) {
            Avatar(url: photo, name: name, size: Pitch<EmptyView>.photo)
                .overlay(Circle().stroke(alt ? PitchColor.yellow : .white.opacity(0.8), lineWidth: 2))
                .shadow(color: .black.opacity(0.3), radius: 4, y: 2)
                .overlay { badges }
            if let points {
                Text(points).font(.system(size: 11.5, weight: .bold)).monospacedDigit().foregroundStyle(.white)
                    .padding(.horizontal, 7).padding(.vertical, 1)
                    .background(Color(light: 0x0A0C10, dark: 0x0A0C10).opacity(0.78), in: Capsule())
                    .padding(.top, 1)
            }
            Text(name)
                .font(.system(size: 12, weight: .semibold))
                .lineLimit(2)
                .multilineTextAlignment(.center)
                .foregroundStyle(.white)
                .shadow(color: .black.opacity(0.55), radius: 1, y: 1)
            if let note {
                Text(note)
                    .font(.system(size: 11, weight: .medium))
                    .lineLimit(2)
                    .multilineTextAlignment(.center)
                    .foregroundStyle(noteColor)
                    .shadow(color: .black.opacity(0.55), radius: 1, y: 1)
            }
        }
    }
}

/// The bright colours that read on the grass (.pitch in global.css), the same in light and dark mode.
enum PitchColor {
    static let green = Color(light: 0x30D158, dark: 0x30D158)
    static let yellow = Color(light: 0xFFD60A, dark: 0xFFD60A)
    static let red = Color(light: 0xFF6961, dark: 0xFF6961)
    static let redDot = Color(light: 0xFF453A, dark: 0xFF453A)
}

/// The badges of a pitch photo (global.css .start-dot, .s11-badge, .swap-hint, .news-badge).
@MainActor
enum PitchBadge {
    /// Will he start: green, yellow, red; white ring like on the photo.
    static func dot(_ color: Color) -> some View {
        Circle().fill(color).frame(width: 14, height: 14).overlay(Circle().stroke(.white, lineWidth: 2))
            .pinned(.topTrailing)
    }

    static var s11: some View {
        Text("S11").font(.system(size: 9, weight: .heavy)).foregroundStyle(.white)
            .padding(.horizontal, 4).frame(height: 15)
            .background(PitchColor.green, in: Capsule()).overlay(Capsule().stroke(.white, lineWidth: 2))
            .pinned(.topTrailing, x: 8, y: -3)
    }

    /// ⇄: someone else may play here. With an action it flips to him; its tap area is the badge (a little
    /// bigger than it looks), never the photo, which opens the card.
    static func swap(top: Bool, action: (() -> Void)? = nil) -> some View {
        Text("⇄").font(.system(size: 11, weight: .bold)).foregroundStyle(.black)
            .frame(width: 18, height: 18).background(PitchColor.yellow, in: Circle())
            .overlay(Circle().stroke(.white, lineWidth: 2))
            .padding(8)
            .contentShape(Circle())
            .onTapGesture { action?() }
            .allowsHitTesting(action != nil)
            .padding(-8)
            .pinned(top ? .topLeading : .bottomLeading, x: -2, y: top ? -2 : 2)
    }

    static var news: some View {
        Image(systemName: "newspaper.fill").font(.system(size: 10)).foregroundStyle(Color(light: 0x1D1D1F, dark: 0x1D1D1F))
            .frame(width: 19, height: 19).background(.white, in: Circle())
            .shadow(color: .black.opacity(0.35), radius: 1.5, y: 1)
            .pinned(.bottomTrailing, x: 6, y: 2)
    }
}
