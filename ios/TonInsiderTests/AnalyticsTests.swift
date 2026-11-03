import Testing
@testable import TonInsider

struct AnalyticsTests {
    @Test func analyticsOffWithoutConfig() {
        #expect(Analytics.settings(token: nil, host: "https://eu.i.posthog.com") == nil)
        #expect(Analytics.settings(token: "", host: "https://eu.i.posthog.com") == nil)
        // An unexpanded build setting counts as missing.
        #expect(Analytics.settings(token: "$(POSTHOG_PROJECT_TOKEN)", host: "https://eu.i.posthog.com") == nil)
        #expect(Analytics.settings(token: "phc_x", host: nil) == nil)
        #expect(Analytics.settings(token: "phc_x", host: "https://eu.i.posthog.com")?.token == "phc_x")
    }
}
