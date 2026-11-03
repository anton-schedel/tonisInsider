import SwiftUI

@main
struct TonInsiderApp: App {
    @State private var feed = FeedStore()
    @State private var account: Account
    @State private var scout: ScoutStore
    @AppStorage("appearance") private var appearance: Appearance = .system

    init() {
        let account = Account()
        _account = State(initialValue: account)
        // The account's list once signed in to Kickbase or LigaInsider (the website's kbin/liin).
        _scout = State(initialValue: ScoutStore { account.kickbase || account.ligaInsider })
    }
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(feed)
                .environment(account)
                .environment(scout)
                .onChange(of: account.kickbase || account.ligaInsider) { Task { await scout.load() } }
                .preferredColorScheme(appearance.scheme)
                .tint(Color.tiForeground)
                .task {
                    feed.loadCached()
                    // While the app is open: a fresh feed every 5 minutes (the scraper's pace).
                    while !Task.isCancelled {
                        await feed.refresh()
                        try? await Task.sleep(for: .seconds(300))
                    }
                }
                .onChange(of: scenePhase) { _, phase in
                    if phase == .active { Task { await feed.refresh() } }
                }
        }
    }
}
