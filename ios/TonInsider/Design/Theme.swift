import SwiftUI
import UIKit

/// The website's colour tokens (src/styles/global.css), light and dark.
extension Color {
    static let tiBackground = Color(light: 0xFFFFFF, dark: 0x000000)
    static let tiSurface = Color(light: 0xF2F2F7, dark: 0x1C1C1E)
    static let tiRaised = Color(light: 0xFFFFFF, dark: 0x2C2C2E)
    static let tiForeground = Color(light: 0x1D1D1F, dark: 0xF5F5F7)
    static let tiMuted = Color(light: 0x86868B, dark: 0x8E8E93)
    static let tiHairline = Color(light: 0xE5E5EA, dark: 0x2C2C2E)
    static let tiGold = Color(light: 0x9C7A2B, dark: 0xD4B05C)
    static let tiRed = Color(light: 0xD70015, dark: 0xFF6961)
    static let tiYellow = Color(light: 0xA05A00, dark: 0xFFD60A)
    static let tiGreen = Color(light: 0x248A3D, dark: 0x30D158)
    static let tiGrey = Color(light: 0x6E6E73, dark: 0xA1A1A6)
    static let tiLive = Color(light: 0xFF453A, dark: 0xFF453A)
    /// The pitch's two grass stripes, the same in light and dark mode (.pitch in global.css).
    static let tiPitch = Color(light: 0x2F8C46, dark: 0x2F8C46)
    static let tiPitchStripe = Color(light: 0x2A8040, dark: 0x2A8040)

    init(light: UInt32, dark: UInt32) {
        self.init(uiColor: UIColor { $0.userInterfaceStyle == .dark ? UIColor(hex: dark) : UIColor(hex: light) })
    }
}

private extension UIColor {
    convenience init(hex: UInt32) {
        self.init(red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255,
                  blue: CGFloat(hex & 0xFF) / 255, alpha: 1)
    }
}
