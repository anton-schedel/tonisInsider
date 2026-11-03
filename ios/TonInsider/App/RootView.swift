import SwiftUI

/// The selected tab, shared so a screen can send the reader elsewhere (e.g. to the logins).
@Observable @MainActor
final class Tabs {
    enum Tab: String { case news, lineups, myTeam, scouting, settings }
    var selected: Tab = .news

    init() {
        #if DEBUG
        // Screenshots: launch with -TITab lineups
        if let raw = UserDefaults.standard.string(forKey: "TITab"), let tab = Tab(rawValue: raw) { selected = tab }
        #endif
    }
}

/// The website's five tabs, each with its own navigation stack (so every tab keeps its place).
struct RootView: View {
    typealias Tab = Tabs.Tab
    @State private var tabs = Tabs()
    @Environment(FeedStore.self) private var feed
    @Environment(ScoutStore.self) private var scout

    /// Scouted players with news since the list was last looked at.
    private var unseen: Int { feed.feed.map { scout.state.unseen(in: $0).count } ?? 0 }

    var body: some View {
        @Bindable var tabs = tabs
        TabView(selection: $tabs.selected) {
            SwiftUI.Tab("News", systemImage: "newspaper", value: Tab.news) {
                NavigationStack { NewsView() }
            }
            SwiftUI.Tab("Aufstellungen", systemImage: "sportscourt", value: Tab.lineups) {
                LineupsStack()
            }
            SwiftUI.Tab("Mein Team", systemImage: "person.crop.circle", value: Tab.myTeam) {
                NavigationStack { MyTeamView() }
            }
            SwiftUI.Tab("Scouting", systemImage: "magnifyingglass", value: Tab.scouting) {
                NavigationStack { ScoutingView() }
            }
            .badge(unseen)
            SwiftUI.Tab("Einstellungen", systemImage: "gearshape", value: Tab.settings) {
                NavigationStack { SettingsView() }
            }
        }
        .environment(tabs)
        .onChange(of: tabs.selected, initial: true) { _, tab in Analytics.screen(tab.rawValue) }
    }
}

/// The lineups tab's stack; in DEBUG, -TIClub <slug> opens a club right away (screenshots).
private struct LineupsStack: View {
    @State private var path: [ClubRoute] = {
        #if DEBUG
        if let slug = UserDefaults.standard.string(forKey: "TIClub") { return [ClubRoute(slug: slug)] }
        #endif
        return []
    }()

    var body: some View {
        NavigationStack(path: $path) { LineupsView() }
    }
}
