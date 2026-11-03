import Testing
@testable import TonInsider

struct SmokeTests {
    @Test func siteURLIsConfigured() {
        #expect(AppConfig.siteURL.scheme == "https")
    }
}
