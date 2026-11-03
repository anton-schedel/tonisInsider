import SwiftUI

/// One player of the league for the search and the scout list (src/lib/players.ts PlayerEntry).
struct PlayerEntry: Identifiable, Hashable {
    var id: Int
    var name: String
    var club: String
    var photo: String?
    var crest: String?
    /// Predicted starters first, then alternatives, then the rest of the squad.
    var rank: Int
    var card: PlayerCardData
    /// Name and club, folded for the search.
    var key: String
}

extension AppFeed {
    /// Every squad player with the card his club page would show; full names, so a search finds first names too.
    func allPlayers() -> [PlayerEntry] {
        var out: [Int: PlayerEntry] = [:]
        for lineup in lineups {
            let confirmedXI = confirmed.contains(lineup.club.id)
            let fullName = Dictionary((lineup.squad ?? []).map { ($0.id, $0.name) }, uniquingKeysWith: { a, _ in a })
            func add(_ p: PlayerRef, rank: Int, pos: String?, status: (String, Tone)) {
                guard out[p.id] == nil else { return }
                var card = PlayerCardData(p, lineup: lineup, feed: self, pos: pos, status: status)
                card.name = fullName[p.id] ?? p.name
                out[p.id] = PlayerEntry(id: p.id, name: card.name, club: lineup.club.name, photo: p.photo, crest: lineup.club.crest,
                                        rank: rank, card: card, key: fold("\(card.name) \(lineup.club.name)"))
            }
            for (i, line) in lineup.lines.enumerated() {
                for p in line {
                    let pos = rowPosition(i, rows: lineup.lines.count)
                    add(PlayerRef(id: p.id, slug: p.slug, name: p.name, photo: p.photo), rank: 0, pos: pos, status: p.start(confirmed: confirmedXI))
                    if let alt = p.alternative { add(alt, rank: 1, pos: pos, status: ("Alternative zu \(p.name)", .yellow)) }
                }
            }
            for p in lineup.squad ?? [] { add(p, rank: 2, pos: nil, status: ("Nicht in der Startelf", .grey)) }
        }
        return Array(out.values)
    }
}

/// Lowercase, without accents (src/lib/format.ts fold).
func fold(_ s: String) -> String {
    s.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "de_DE")).replacingOccurrences(of: "ß", with: "ss")
}

/// Scouting (src/pages/scouting.astro): search every squad player; the scout list with its players' news;
/// without one, players in this week's news to start with.
struct ScoutingView: View {
    @Environment(FeedStore.self) private var feedStore
    @Environment(ScoutStore.self) private var scout
    @State private var query = ""
    @State private var card: PlayerCardData?

    var body: some View {
        let players = feedStore.feed?.allPlayers() ?? []
        let byId = Dictionary(players.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        List {
            if !query.trimmingCharacters(in: .whitespaces).isEmpty {
                let q = fold(query.trimmingCharacters(in: .whitespaces))
                let hits = players.filter { $0.key.contains(q) }.sorted { ($0.rank, $0.name) < ($1.rank, $1.name) }
                Section {
                    if hits.isEmpty { Text("Kein Spieler gefunden.").foregroundStyle(Color.tiMuted) }
                    ForEach(hits.prefix(40)) { row($0) }
                    if hits.count > 40 { Text("\(hits.count - 40) weitere: genauer suchen.").font(.system(size: 12)).foregroundStyle(Color.tiMuted) }
                }
            } else {
                Section {
                    if scout.state.ids.isEmpty {
                        Text("Beobachte Spieler, die du nicht im Team hast: Ihre News landen hier, und der Tab zeigt dir, wenn es Neues gibt.")
                            .foregroundStyle(Color.tiMuted)
                    }
                    ForEach(scout.state.ids.compactMap { byId[$0] }) { row($0, latestNews: true) }
                } header: {
                    HStack {
                        Text("Scoutliste")
                        Spacer()
                        if !scout.state.ids.isEmpty { Text("\(scout.state.ids.count)").monospacedDigit() }
                    }
                } footer: {
                    Text(scout.state.account ? "Gespeichert mit deinem Konto, auch auf der Website." : "Nur auf diesem iPhone gespeichert. Melde dich an, um sie mit der Website zu teilen.")
                        .font(.system(size: 12)).foregroundStyle(Color.tiMuted)
                }
                if scout.state.ids.isEmpty, let feed = feedStore.feed {
                    // Something to scout right away: players in this week's news.
                    let week = Date.now.addingTimeInterval(-7 * 86400)
                    let ids = feed.visibleArticles(now: .now).filter { $0.publishedAt >= week }.compactMap { $0.player?.id }
                    let suggest = ids.reduce(into: [Int]()) { if !$0.contains($1) { $0.append($1) } }.prefix(8).compactMap { byId[$0] }
                    if !suggest.isEmpty {
                        Section("Gerade in den News") { ForEach(suggest) { row($0, latestNews: true) } }
                    }
                }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(Color.tiBackground)
        .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Spieler oder Verein suchen")
        .navigationTitle("Scouting")
        .task { await scout.load() }
        .onDisappear { Task { await scout.markSeen() } }
        .sheet(item: $card) { PlayerCardView(data: $0) }
        .withSiteRoutes()
    }

    private func row(_ p: PlayerEntry, latestNews: Bool = false) -> some View {
        HStack(spacing: 12) {
            Button { card = p.card } label: {
                HStack(spacing: 12) {
                    Avatar(url: siteURL(p.photo), name: p.name, size: 44)
                        .overlay(alignment: .bottomTrailing) { Crest(url: siteURL(p.crest), size: 18).offset(x: 4, y: 2) }
                    VStack(alignment: .leading, spacing: 3) {
                        Text(p.name).font(.system(size: 16, weight: .semibold))
                        if latestNews, let news = p.card.news?.first {
                            Text(news.title).font(.system(size: 13)).foregroundStyle(Color.tiMuted).lineLimit(1)
                        } else {
                            Text(p.club).font(.system(size: 13)).foregroundStyle(Color.tiMuted)
                        }
                    }
                    Spacer(minLength: 0)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            ScoutButton(playerId: p.id, compact: true)
        }
        .listRowBackground(Color.tiBackground)
    }
}

/// Puts a player on the scout list or takes him off (star), shown at once.
struct ScoutButton: View {
    let playerId: Int
    var compact = false
    @Environment(ScoutStore.self) private var scout

    var body: some View {
        let on = scout.contains(playerId)
        Button {
            Task { await scout.set(playerId, on: !on) }
        } label: {
            if compact {
                Image(systemName: on ? "star.fill" : "star").foregroundStyle(on ? Color.tiGold : Color.tiMuted).font(.system(size: 18))
            } else {
                Label(on ? "Gescoutet" : "Scouten", systemImage: on ? "star.fill" : "star")
                    .font(.system(size: 15, weight: .semibold)).frame(maxWidth: .infinity).padding(.vertical, 12)
                    .background(Color.tiSurface, in: RoundedRectangle(cornerRadius: 12))
                    .foregroundStyle(on ? Color.tiGold : Color.tiForeground)
            }
        }
        .buttonStyle(.plain)
        .sensoryFeedback(.selection, trigger: on)
    }
}
