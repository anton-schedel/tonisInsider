import SwiftUI

/// One player of the league for the search and the scout list (src/lib/players.ts PlayerEntry).
struct PlayerEntry: Identifiable, Hashable, Sendable {
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
        // Each player's articles, looked up once for everyone (newest first, like the feed).
        let newsByPlayer = Dictionary(grouping: articles.filter { $0.player != nil }, by: { $0.player!.id })
        for lineup in lineups {
            let confirmedXI = confirmed.contains(lineup.club.id)
            let fullName = Dictionary((lineup.squad ?? []).map { ($0.id, $0.name) }, uniquingKeysWith: { a, _ in a })
            func add(_ p: PlayerRef, rank: Int, pos: String?, status: (String, Tone)) {
                guard out[p.id] == nil else { return }
                var card = PlayerCardData(p, lineup: lineup, feed: self, pos: pos, status: status, news: newsByPlayer[p.id] ?? [])
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
/// without one, players in this week's news to start with. The player list is built in the background (FeedStore).
struct ScoutingView: View {
    @Environment(FeedStore.self) private var feedStore
    @Environment(ScoutStore.self) private var scout
    @State private var query = ""
    @State private var card: PlayerCardData?
    @FocusState private var searching: Bool

    var body: some View {
        let byId = feedStore.players
        let q = fold(query.trimmingCharacters(in: .whitespaces))
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                PageHeader(title: "Scouting")
                searchField.padding(.bottom, 12)
                if !q.isEmpty {
                    let hits = byId.values.filter { $0.key.contains(q) }.sorted { ($0.rank, $0.name) < ($1.rank, $1.name) }
                    if byId.isEmpty { ProgressView().frame(maxWidth: .infinity).padding(.vertical, 24) }
                    else if hits.isEmpty { EmptyNote(text: "Kein Spieler gefunden.") }
                    rows(Array(hits.prefix(40)), latestNews: false)
                    if hits.count > 40 {
                        Text("\(hits.count - 40) weitere: genauer suchen.").font(.system(size: 12)).foregroundStyle(Color.tiMuted)
                            .frame(maxWidth: .infinity).padding(.vertical, 12)
                    }
                } else {
                    SectionTitle(title: "Scoutliste", detail: scout.state.ids.isEmpty ? nil : "\(scout.state.ids.count)")
                        .padding(.top, 16).padding(.bottom, 4)
                    if scout.state.ids.isEmpty {
                        Text("Beobachte Spieler, die du nicht im Team hast: Ihre News landen hier, und der Tab zeigt dir, wenn es Neues gibt.")
                            .font(.system(size: 15)).foregroundStyle(Color.tiMuted).padding(.vertical, 4)
                        let suggest = suggestions(byId)
                        if !suggest.isEmpty {
                            Text("Gerade in den News").font(.system(size: 15, weight: .semibold)).padding(.top, 20).padding(.bottom, 4)
                            rows(suggest, latestNews: true)
                        }
                    } else {
                        rows(scout.state.ids.compactMap { byId[$0] }, latestNews: true)
                    }
                    Text(scout.state.account ? "Gespeichert mit deinem Konto, auch auf der Website." : "Nur auf diesem iPhone gespeichert. Melde dich an, um sie mit der Website zu teilen.")
                        .font(.system(size: 12)).foregroundStyle(Color.tiMuted).padding(.top, 12)
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 32)
        }
        .scrollDismissesKeyboard(.immediately)
        .background(Color.tiBackground)
        .navigationTitle("Scouting")
        .tabRoot()
        .onDisappear { Task { await scout.markSeen() } }
        .sheet(item: $card) { PlayerCardView(data: $0) }
        .withSiteRoutes()
    }

    /// The site's search field (.search-field): grey, rounded, a clear button while there's text.
    private var searchField: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass").font(.system(size: 16, weight: .semibold)).foregroundStyle(Color.tiMuted)
            TextField("Spieler oder Verein suchen", text: $query)
                .textInputAutocapitalization(.never).autocorrectionDisabled().submitLabel(.search).focused($searching)
            if !query.isEmpty {
                Button { query = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(Color.tiMuted) }
                    .buttonStyle(.plain).accessibilityLabel("Suche leeren")
            }
        }
        .font(.system(size: 16))
        .padding(.horizontal, 14).frame(height: 44)
        .background(Color.tiSurface, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    /// Something to scout right away: players in this week's news.
    private func suggestions(_ byId: [Int: PlayerEntry]) -> [PlayerEntry] {
        guard let feed = feedStore.feed else { return [] }
        let week = Date.now.addingTimeInterval(-7 * 86400)
        var seen = Set<Int>()
        return feed.visibleArticles(now: .now).filter { $0.publishedAt >= week }.compactMap { $0.player?.id }
            .filter { seen.insert($0).inserted }.prefix(8).compactMap { byId[$0] }
    }

    private func rows(_ players: [PlayerEntry], latestNews: Bool) -> some View {
        ForEach(Array(players.enumerated()), id: \.element.id) { index, p in
            if index > 0 { Divider().overlay(Color.tiHairline).padding(.leading, 56) }
            HStack(spacing: 12) {
                Button { card = p.card } label: {
                    HStack(spacing: 12) {
                        Avatar(url: siteURL(p.photo), name: p.name, size: 44)
                            .overlay { Crest(url: siteURL(p.crest), size: 18).pinned(.bottomTrailing, x: 4, y: 2) }
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
            .padding(.vertical, 10)
        }
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
                    .frame(width: 44, height: 44).contentShape(Rectangle())
            } else {
                Label(on ? "Gescoutet" : "Scouten", systemImage: on ? "star.fill" : "star")
                    .font(.system(size: 16, weight: .semibold)).frame(maxWidth: .infinity, minHeight: 48)
                    .background(Color.tiSurface, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .foregroundStyle(on ? Color.tiGold : Color.tiForeground)
            }
        }
        .buttonStyle(.plain)
        .sensoryFeedback(.selection, trigger: on)
    }
}
