import SwiftUI

@main
struct TonInsiderApp: App {
    @State private var feed = FeedStore()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(feed)
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
