import SwiftUI

@main
struct TonInsiderApp: App {
    @State private var feed = FeedStore()
    @State private var account: Account
    @State private var scout: ScoutStore
    @State private var chats: ChatsModel
    @AppStorage("appearance") private var appearance: Appearance?

    init() {
        Analytics.start()
        let account = Account()
        _account = State(initialValue: account)
        // The account's list once signed in to Kickbase or LigaInsider (the website's kbin/liin).
        _scout = State(initialValue: ScoutStore { account.kickbase || account.ligaInsider })
        // "Deine Chats" belong to the LigaInsider login.
        _chats = State(initialValue: ChatsModel { account.ligaInsider })
    }
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(feed)
                .environment(account)
                .environment(scout)
                .environment(chats)
                .onChange(of: account.kickbase || account.ligaInsider) { Task { await scout.load() } }
                .onChange(of: account.ligaInsider) { Task { await chats.check(force: true) } }
                .task {
                    // The bubble's red number: a look every few minutes while the app is open (ChatsModel.checkEvery).
                    while !Task.isCancelled {
                        await chats.check()
                        try? await Task.sleep(for: .seconds(60))
                    }
                }
                .preferredColorScheme(appearance?.scheme)
                .tint(Color.tiForeground)
                .task { await scout.load() }
                .task {
                    await feed.loadCached()
                    // While the app is open: a look every 30 s. Unchanged, the site answers 304 without the feed
                    // (ETag); new articles reach the site within about a minute (the Worker's news check).
                    while !Task.isCancelled {
                        await feed.refresh()
                        try? await Task.sleep(for: .seconds(30))
                    }
                }
                .onChange(of: scenePhase) { _, phase in
                    if phase == .active { Task { await feed.refresh(); await chats.check() } }
                }
        }
    }
}
