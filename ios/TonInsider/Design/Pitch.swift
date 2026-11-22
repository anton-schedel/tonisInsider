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
    /// Kickbase points, from kickoff on (PointsChip); with `pointsLoading` a placeholder where they will be.
    var points: PointsLabel?
    var pointsLoading = false
    /// Laid over the photo: place each with .pinned(…).
    @ViewBuilder var badges: Badges

    var body: some View {
        VStack(spacing: 3) {
            Avatar(url: photo, name: name, size: Pitch<EmptyView>.photo)
                .overlay(Circle().stroke(alt ? PitchColor.yellow : .white.opacity(0.8), lineWidth: 2))
                .shadow(color: .black.opacity(0.3), radius: 4, y: 2)
                .overlay { badges }
            if points != nil || pointsLoading {
                PointsChip(label: points).padding(.top, 1)
            }
            Text(name)
                .font(.system(size: 12, weight: .semibold))
                .lineLimit(2)
                .multilineTextAlignment(.center)
                .foregroundStyle(.white)
                .shadow(color: .black.opacity(0.55), radius: 1, y: 1)
            if let note {
                // One line, as on the website (.pitch-note): a second one ("bis 88' · Codjo-Evora") ran into the
                // row of players below.
                Text(note)
                    .font(.system(size: 11, weight: .medium))
                    .lineLimit(1)
                    .truncationMode(.tail)
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

/// What the marks on a pitch mean, in a centred line under it that wraps (PitchField.astro's legend): small, muted.
/// Each pitch names its own items: a mark with its word, or words alone ("Tippen für Prognose").
struct PitchLegend: View {
    struct Item: Hashable {
        var mark: Mark?
        var text: String

        init(_ text: String, mark: Mark? = nil) {
            self.text = text
            self.mark = mark
        }
    }

    enum Mark: Hashable {
        /// The dot of a photo's corner, in the page's colours (.legend-dot).
        case dot(Dot)
        /// The confirmed XI's badge.
        case s11
        /// The newspaper of fresh news.
        case news
        /// A match report's marks on the photo: goal, assist, card.
        case goal, assist, card
    }

    enum Dot: Hashable {
        case green, yellow, red, muted

        var color: Color {
            switch self {
            case .green: PitchColor.green
            case .yellow: Color(light: 0xFFCC00, dark: 0xFFD60A)
            case .red: .tiRed
            case .muted: .tiMuted
            }
        }
    }

    let items: [Item]

    var body: some View {
        WrappedLine(spacing: 16, lineSpacing: 4) {
            ForEach(items, id: \.self) { item in
                HStack(spacing: 4) {
                    if let mark = item.mark { Self.view(mark).accessibilityHidden(true) }
                    Text(item.text)
                }
            }
        }
        .font(.system(size: 11))
        .foregroundStyle(Color.tiMuted)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 12)
    }

    @ViewBuilder private static func view(_ mark: Mark) -> some View {
        switch mark {
        case .dot(let dot):
            Circle().fill(dot.color).frame(width: 8, height: 8)
        case .s11:
            Text("S11").font(.system(size: 9, weight: .heavy)).foregroundStyle(.white)
                .padding(.horizontal, 4).frame(height: 13).background(PitchColor.green, in: Capsule())
        case .news:
            Image(systemName: "newspaper.fill").font(.system(size: 9)).foregroundStyle(Color.tiForeground)
                .frame(width: 18, height: 18).background(Color.tiSurface, in: Circle())
        case .goal:
            Text("⚽").font(.system(size: 10))
        case .assist:
            Text("A").font(.system(size: 9, weight: .bold)).foregroundStyle(.white)
                .frame(width: 13, height: 13).background(Circle().fill(.black.opacity(0.55)))
        case .card:
            RoundedRectangle(cornerRadius: 1.5).fill(PitchColor.yellow).frame(width: 8, height: 11)
        }
    }
}

/// Items side by side, centred, wrapping to a next centred line when they don't fit (the website's
/// "flex flex-wrap justify-center").
private struct WrappedLine: Layout {
    var spacing: CGFloat
    var lineSpacing: CGFloat

    private func lines(_ subviews: Subviews, width: CGFloat) -> [(items: [(index: Int, size: CGSize)], width: CGFloat, height: CGFloat)] {
        var lines: [(items: [(index: Int, size: CGSize)], width: CGFloat, height: CGFloat)] = []
        for (index, subview) in subviews.enumerated() {
            let size = subview.sizeThatFits(ProposedViewSize(width: width, height: nil))
            if let last = lines.last, last.width + spacing + size.width <= width {
                lines[lines.count - 1].items.append((index, size))
                lines[lines.count - 1].width = last.width + spacing + size.width
                lines[lines.count - 1].height = max(last.height, size.height)
            } else {
                lines.append(([(index, size)], size.width, size.height))
            }
        }
        return lines
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let lines = lines(subviews, width: proposal.width ?? .infinity)
        let height = lines.map(\.height).reduce(0, +) + lineSpacing * CGFloat(max(0, lines.count - 1))
        return CGSize(width: lines.map(\.width).max() ?? 0, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var y = bounds.minY
        for line in lines(subviews, width: bounds.width) {
            var x = bounds.midX - line.width / 2
            for item in line.items {
                subviews[item.index].place(at: CGPoint(x: x, y: y + (line.height - item.size.height) / 2), proposal: ProposedViewSize(item.size))
                x += item.size.width + spacing
            }
            y += line.height + lineSpacing
        }
    }
}
