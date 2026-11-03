import Foundation

/// Values from the git-ignored Local.xcconfig, carried into Info.plist at build time.
enum AppConfig {
    /// The TonInsider site (the Worker): the feed, images and the API.
    static let siteURL: URL = {
        #if DEBUG
        // Development against the local dev server: launch with -TISiteURL http://localhost:4399
        if let raw = UserDefaults.standard.string(forKey: "TISiteURL"), let url = URL(string: raw), url.host != nil { return url }
        #endif
        guard let raw = Bundle.main.object(forInfoDictionaryKey: "TISiteURL") as? String,
              let url = URL(string: raw), url.host != nil
        else { fatalError("TISiteURL missing: set SITE_URL in ios/Config/Local.xcconfig") }
        return url
    }()
}
