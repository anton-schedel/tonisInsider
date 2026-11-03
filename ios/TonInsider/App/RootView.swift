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
                NavigationStack { Placeholder(title: "Mein Team") }
            }
            SwiftUI.Tab("Scouting", systemImage: "magnifyingglass", value: Tab.scouting) {
                NavigationStack { Placeholder(title: "Scouting") }
            }
            SwiftUI.Tab("Einstellungen", systemImage: "gearshape", value: Tab.settings) {
                NavigationStack { SettingsView() }
            }
        }
        .environment(tabs)
    }
}

/// Stands in for a tab until its screen exists.
private struct Placeholder: View {
    let title: String
    var body: some View {
        Text(title)
            .foregroundStyle(Color.tiMuted)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color.tiBackground)
            .navigationTitle(title)
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
