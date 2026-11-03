import SwiftUI

/// The website's five tabs, each with its own navigation stack (so every tab keeps its place).
struct RootView: View {
    enum Tab: String { case news, lineups, myTeam, scouting, settings }

    @SceneStorage("tab") private var tab: Tab = .news

    var body: some View {
        TabView(selection: $tab) {
            SwiftUI.Tab("News", systemImage: "newspaper", value: Tab.news) {
                NavigationStack { NewsView() }
            }
            SwiftUI.Tab("Aufstellungen", systemImage: "sportscourt", value: Tab.lineups) {
                NavigationStack { Placeholder(title: "Aufstellungen") }
            }
            SwiftUI.Tab("Mein Team", systemImage: "person.crop.circle", value: Tab.myTeam) {
                NavigationStack { Placeholder(title: "Mein Team") }
            }
            SwiftUI.Tab("Scouting", systemImage: "magnifyingglass", value: Tab.scouting) {
                NavigationStack { Placeholder(title: "Scouting") }
            }
            SwiftUI.Tab("Einstellungen", systemImage: "gearshape", value: Tab.settings) {
                NavigationStack { Placeholder(title: "Einstellungen") }
            }
        }
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
