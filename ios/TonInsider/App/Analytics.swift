import Foundation
import PostHog

/// Usage analytics like the website's (PostHog, same project): screen views, the Kickbase login, and the Kickbase
/// account id once known. Without a token in Local.xcconfig nothing is set up and nothing is sent.
enum Analytics {
    struct Settings: Equatable { let token: String; let host: String }

    /// The configured token and host, or nil when either is missing (or an unexpanded build setting).
    static func settings(token: String?, host: String?) -> Settings? {
        guard let token, let host, !token.isEmpty, !host.isEmpty, !token.hasPrefix("$("), !host.hasPrefix("$(") else { return nil }
        return Settings(token: token, host: host)
    }

    nonisolated(unsafe) private static var enabled = false

    static func start() {
        let info = Bundle.main.infoDictionary
        guard let s = settings(token: info?["TIPostHogToken"] as? String, host: info?["TIPostHogHost"] as? String) else { return }
        let config = PostHogConfig(projectToken: s.token, host: s.host)
        config.captureScreenViews = false
        config.captureApplicationLifecycleEvents = true
        PostHogSDK.shared.setup(config)
        enabled = true
    }

    static func screen(_ name: String) {
        guard enabled else { return }
        PostHogSDK.shared.screen(name)
    }

    static func capture(_ event: String) {
        guard enabled else { return }
        PostHogSDK.shared.capture(event)
    }

    /// The Kickbase account id: a stable identifier, as the website uses it.
    static func identify(_ userId: String?) {
        guard enabled, let userId, !userId.isEmpty else { return }
        PostHogSDK.shared.identify(userId)
    }
}
