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

    var body: some View {
        Text(text)
            .font(.system(size: 12, weight: .semibold))
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
