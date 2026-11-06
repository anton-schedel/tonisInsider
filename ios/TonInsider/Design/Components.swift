import SwiftUI

/// A round photo; initials on the grey placeholder when there is none. Own posts' photos keep the head (top).
struct Avatar: View {
    let url: URL?
    let name: String
    var size: CGFloat = 64
    var top = false

    var body: some View {
        ZStack {
            Color.tiSurface
            if url == nil {
                Text(initials(name)).font(.system(size: size * 0.34, weight: .semibold)).foregroundStyle(Color.tiMuted)
            } else {
                RemoteImage(url: url)
                    .frame(width: size, height: size, alignment: top ? .top : .center)
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
    }
}

/// A club crest, whole (never cropped).
struct Crest: View {
    let url: URL?
    var size: CGFloat = 64

    var body: some View {
        RemoteImage(url: url, contentMode: .fit, placeholder: false)
            .frame(width: size, height: size)
    }
}

/// TonInsider's own logo, for posts with neither player nor club.
struct LogoAvatar: View {
    var size: CGFloat = 64
    var body: some View {
        Image("Logo").resizable().scaledToFit().frame(width: size, height: size).clipShape(Circle())
    }
}

enum Tone {
    case red, yellow, green, grey

    var foreground: Color {
        switch self { case .red: .tiRed; case .yellow: .tiYellow; case .green: .tiGreen; case .grey: .tiGrey }
    }
    var background: Color {
        switch self { case .red: .tiRedBackground; case .yellow: .tiYellowBackground; case .green: .tiGreenBackground; case .grey: .tiGreyBackground }
    }
}

/// The small coloured label of a news type or start status (.pill in global.css).
struct Pill: View {
    let text: String
    let tone: Tone
    /// The player card's bigger one (.pill-lg).
    var large = false

    var body: some View {
        Text(text)
            .font(.system(size: large ? 12.5 : 11.5, weight: .semibold))
            .lineLimit(1)
            .padding(.horizontal, 7)
            .padding(.vertical, 2)
            .foregroundStyle(tone.foreground)
            .background(tone.background, in: Capsule())
    }
}

extension NewsType {
    /// Label and colour (src/lib/newsTypes.ts); "sonstiges" has none.
    var pill: (label: String, tone: Tone)? {
        switch self {
        case .verletzung: ("Verletzung", .red)
        case .angeschlagen: ("Angeschlagen", .yellow)
        case .aufbautraining: ("Aufbautraining", .green)
        case .fit: ("Fit", .green)
        case .sonstiges: nil
        }
    }
}

func initials(_ name: String) -> String {
    let parts = name.replacingOccurrences(of: ".", with: "").split(separator: " ")
    let first = parts.first?.first.map(String.init) ?? ""
    let last = parts.count > 1 ? parts.last!.first.map(String.init) ?? "" : ""
    return (first + last).uppercased()
}

/// "Noch keine News." and the like: calm, centred, muted.
struct EmptyNote: View {
    let text: String
    var body: some View {
        Text(text).foregroundStyle(Color.tiMuted).frame(maxWidth: .infinity).padding(.vertical, 40)
    }
}

/// The site's buttons (.btn in global.css): primary black on white (white on black in dark mode), quiet grey.
struct SiteButtonStyle: ButtonStyle {
    enum Kind { case primary, quiet, destructive }
    var kind: Kind = .primary
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 16, weight: .semibold))
            .frame(maxWidth: .infinity, minHeight: 48)
            .foregroundStyle(kind == .primary ? Color.tiBackground : kind == .destructive ? Color.tiRed : Color.tiForeground)
            .background(kind == .primary ? Color.tiForeground : Color.tiSurface, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .opacity(isEnabled ? 1 : 0.4)
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

extension ButtonStyle where Self == SiteButtonStyle {
    static var primary: SiteButtonStyle { SiteButtonStyle(kind: .primary) }
    static var quiet: SiteButtonStyle { SiteButtonStyle(kind: .quiet) }
    static var destructiveQuiet: SiteButtonStyle { SiteButtonStyle(kind: .destructive) }
}

extension View {
    /// A text field as the site draws it (.field): grey, rounded, no border.
    func siteField() -> some View {
        padding(.horizontal, 16).padding(.vertical, 13)
            .background(Color.tiSurface, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .font(.system(size: 16))
    }

    /// Places a badge at a corner of the view it overlays, nudged outwards like the site's photo badges.
    func pinned(_ alignment: Alignment, x: CGFloat = 0, y: CGFloat = 0) -> some View {
        frame(maxWidth: .infinity, maxHeight: .infinity, alignment: alignment).offset(x: x, y: y)
    }
}

/// A tab's title as the website draws it (Base.astro header): 28 pt bold, close under the status bar, our wordmark
/// on the right where the site shows it (News, Einstellungen). Replaces the system's large title, which left a lot
/// of space above it.
struct PageHeader: View {
    let title: String
    var logo = false
    /// A round button left of the wordmark (News: "Deine Chats").
    var accessory: AnyView? = nil

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            Text(title).font(.system(size: 28, weight: .bold)).tracking(-0.84).lineLimit(1).minimumScaleFactor(0.8)
            Spacer(minLength: 0)
            if let accessory { accessory }
            if logo { Image("Wordmark").resizable().scaledToFit().frame(height: 26).accessibilityLabel("TonInsider") }
        }
        .frame(minHeight: 44)
        .padding(.top, 8)
        .padding(.bottom, 8)
    }
}

extension View {
    /// A tab's root screen: our own header instead of the navigation bar (pushed pages keep theirs).
    func tabRoot() -> some View {
        toolbar(.hidden, for: .navigationBar)
    }
}

/// Instant feedback for anything tappable that isn't a regular button (players, rows, cards): it gives a little
/// under the finger and a light tick, then springs back (the site's .press).
struct PressStyle: ButtonStyle {
    var scale: CGFloat = 0.95

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? scale : 1)
            .opacity(configuration.isPressed ? 0.85 : 1)
            .animation(.spring(response: 0.22, dampingFraction: 0.7), value: configuration.isPressed)
            .sensoryFeedback(.selection, trigger: configuration.isPressed) { _, pressed in pressed }
    }
}

extension ButtonStyle where Self == PressStyle {
    static var press: PressStyle { PressStyle() }
    /// For whole rows: a smaller give, so a wide row doesn't jump.
    static var pressRow: PressStyle { PressStyle(scale: 0.985) }
}
