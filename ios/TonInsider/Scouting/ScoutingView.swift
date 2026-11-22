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
    /// What the search finds him by (ScoutSearch.key).
    var key: String
}

extension AppFeed {
    /// Every squad player with the card his club page would show; full names, so a search finds first names too.
    func allPlayers() -> [PlayerEntry] {
        var out: [Int: PlayerEntry] = [:]
        // Each player's articles, looked up once for everyone (newest first, like the feed).
        let newsByPlayer = Dictionary(grouping: articles.filter { $0.player != nil }, by: { $0.player!.id })
        // Posts scheduled for later stay in (the list is built once per feed); the screens show them from their minute.
        for lineup in lineups {
            let confirmedXI = confirmed.contains(lineup.club.id)
            let fullName = Dictionary((lineup.squad ?? []).map { ($0.id, $0.name) }, uniquingKeysWith: { a, _ in a })
            func add(_ p: PlayerRef, rank: Int, pos: String?, status: (String, Tone)) {
                guard out[p.id] == nil else { return }
                var card = PlayerCardData(p, lineup: lineup, feed: self, pos: pos, status: status, news: newsByPlayer[p.id] ?? [])
                card.name = fullName[p.id] ?? p.name
                // Found by a search, his club is one tap away ("Zum Verein", as on the website).
                card.href = "/vereine/\(lineup.club.slug)/"
                out[p.id] = PlayerEntry(id: p.id, name: card.name, club: lineup.club.name, photo: p.photo, crest: lineup.club.crest,
                                        rank: rank, card: card, key: ScoutSearch.key(name: card.name, club: lineup.club.name))
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

/// Scouting (src/pages/scouting.astro): search every squad player; the scout list with its players' news;
/// without one, players in the news to start with. The player list is built in the background (FeedStore).
struct ScoutingView: View {
    @Environment(FeedStore.self) private var feedStore
    @Environment(ScoutStore.self) private var scout
    @Environment(Tabs.self) private var tabs
    @State private var query: String = {
        #if DEBUG
        // Screenshots: launch with -TIQuery bvb
        if let query = UserDefaults.standard.string(forKey: "TIQuery") { return query }
        #endif
        return ""
    }()
    @State private var card: PlayerCardData?
    /// Scouted players with news since the last look. The list counts as seen as soon as it's opened, but their
    /// dots stay for this visit.
    @State private var fresh = Set<Int>()
    /// Suggestions tapped on this visit: their + is a tick at once, also while the save waits its turn.
    @State private var added = Set<Int>()
    /// Once a suggestion was added on this visit, the suggestions stay so more of them can be added.
    @State private var keepSuggestions = false
    /// Taps are saved one after the other, so quick taps on several players all count.
    @State private var saving: Task<Void, Never>?
    @FocusState private var searching: Bool

    var body: some View {
        let byId = feedStore.players
        let now = Date.now
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                PageHeader(title: "Scouting")
                searchField.padding(.bottom, 12)
                if !query.trimmingCharacters(in: .whitespaces).isEmpty {
                    results(byId)
                } else {
                    list(byId, now: now)
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 32)
        }
        .scrollDismissesKeyboard(.immediately)
        .background(Color.tiBackground)
        .navigationTitle("Scouting")
        .tabRoot()
        // Opened with something new: the list counts as seen (the tab's number goes), as on the website.
        .onChange(of: tabs.selected, initial: true) { _, tab in
            if tab == .scouting { look() } else { fresh = []; added = []; keepSuggestions = false }
        }
        .onChange(of: scout.state) { old, new in
            look()
            // A player picked from the results: back to the list, where he now is.
            if card != nil, new.ids.count > old.ids.count, !query.isEmpty {
                query = ""
                searching = false
            }
        }
        .onChange(of: feedStore.feed?.generatedAt) { look() }
        .playerCard($card)
        .withSiteRoutes()
        #if DEBUG
        .task(id: byId.isEmpty) {
            // Screenshots: -TIScoutCard <LigaInsider player id> opens that player's card.
            if let p = byId[UserDefaults.standard.integer(forKey: "TIScoutCard")] { card = p.card }
        }
        #endif
    }

    /// News since the last look get their dot, and the list counts as seen.
    private func look() {
        guard tabs.selected == .scouting, let feed = feedStore.feed else { return }
        let new = scout.state.unseen(in: feed)
        guard !new.isEmpty else { return }
        fresh.formUnion(new)
        Task { await scout.markSeen() }
    }

    /// The site's search field (.search-field): grey, rounded, a clear button while there's text.
    private var searchField: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass").font(.system(size: 16, weight: .semibold)).foregroundStyle(Color.tiMuted)
            TextField("Spieler oder Verein suchen", text: $query)
                .textInputAutocapitalization(.never).autocorrectionDisabled().submitLabel(.search).focused($searching)
            if !query.isEmpty {
                Button { query = ""; searching = true } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(Color.tiMuted) }
                    .buttonStyle(.plain).accessibilityLabel("Suche leeren")
            }
        }
        .font(.system(size: 16))
        .padding(.horizontal, 14).frame(height: 44)
        .background(Color.tiSurface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    /// The search's hits: club and status under the name, a star on those already scouted.
    @ViewBuilder private func results(_ byId: [Int: PlayerEntry]) -> some View {
        let (hits, more) = ScoutSearch.search(byId.values, query)
        if byId.isEmpty { ProgressView().frame(maxWidth: .infinity).padding(.vertical, 24) }
        else if hits.isEmpty { EmptyNote(text: "Kein Spieler gefunden.") }
        rows(hits, in: "results") { p in
            ScoutRow(player: p, trail: scout.contains(p.id) ? .star : .none) { card = p.card }
        }
        if more > 0 {
            Text("Und \(more) weitere: schreib etwas mehr vom Namen.").font(.system(size: 12)).foregroundStyle(Color.tiMuted)
                .frame(maxWidth: .infinity).padding(.vertical, 16)
        }
    }

    /// The scout list, each player with his latest news; without one (and after adding from them) the suggestions.
    @ViewBuilder private func list(_ byId: [Int: PlayerEntry], now: Date) -> some View {
        let players = ScoutList.sorted(scout.state.ids.compactMap { byId[$0] }, fresh: fresh, now: now)
        SectionTitle(title: "Scoutliste", detail: players.isEmpty ? nil : "\(players.count)")
            .padding(.top, 16).padding(.bottom, 4)
        rows(players, in: "list") { p in
            ScoutRow(player: p, news: p.latestNews(now: now), fresh: fresh.contains(p.id), now: now) { card = p.card }
                .transition(.opacity.combined(with: .offset(y: 8)))
        }
        .animation(.easeOut(duration: 0.3), value: scout.state.ids)
        if scout.state.ids.isEmpty {
            Text("Beobachte Spieler, die du nicht im Team hast: Ihre News landen hier, und der Tab zeigt dir, wenn es Neues gibt.")
                .font(.system(size: 15)).foregroundStyle(Color.tiMuted).padding(.vertical, 4)
        }
        if scout.state.ids.isEmpty || keepSuggestions {
            let suggest = ScoutList.suggestions(byId.values, now: now)
            if !suggest.isEmpty {
                Text("Gerade in den News").font(.system(size: 15, weight: .semibold)).padding(.top, 20).padding(.bottom, 4)
                // A + that didn't save says why right here (a star's failure is told in the card).
                if card == nil { ScoutProblem().padding(.vertical, 4) }
                rows(suggest, in: "suggestions") { p in
                    ScoutRow(player: p, news: p.latestNews(now: now), now: now,
                             trail: .add(done: added.contains(p.id) || scout.contains(p.id)) { add(p.id) }) { card = p.card }
                }
            }
        }
        if scout.state.account {
            Text("Gespeichert mit deinem Konto, auch auf der Website.").font(.system(size: 12)).foregroundStyle(Color.tiMuted).padding(.top, 12)
        } else if !scout.state.ids.isEmpty {
            Text("Nur auf diesem iPhone gespeichert. Melde dich an, um sie mit der Website zu teilen.")
                .font(.system(size: 12)).foregroundStyle(Color.tiMuted).padding(.top, 12)
        }
    }

    /// The + on a suggestion: it turns into a tick and he joins the list; the suggestions stay for more.
    private func add(_ id: Int) {
        keepSuggestions = true
        added.insert(id)
        let before = saving
        saving = Task {
            await before?.value
            if await !scout.set(id, on: true) { added.remove(id) }
        }
    }

    /// `section` keeps the rows of the list and of the suggestions apart: a player just added is in both, and two
    /// rows with one identity in the same stack get mixed up.
    private func rows<Row: View>(_ players: [PlayerEntry], in section: String, @ViewBuilder row: @escaping (PlayerEntry) -> Row) -> some View {
        ForEach(players.enumerated().map { (key: "\(section)-\($0.element.id)", index: $0.offset, player: $0.element) }, id: \.key) { item in
            if item.index > 0 { Divider().overlay(Color.tiHairline) }
            row(item.player)
        }
    }
}

/// One player (scouting.astro row): photo with crest, name, then his club and status, or (scout list) his latest
/// news. Unread news: a dot before the name and the headline in full colour, like an unread mail. At the end a
/// star (already scouted) or a + that scouts him without opening the card.
private struct ScoutRow: View {
    enum Trail { case none, star, add(done: Bool, action: () -> Void) }

    let player: PlayerEntry
    /// His latest news instead of club and status.
    var news: PlayerCardData.CardNews?
    var fresh = false
    var now: Date = .now
    var trail: Trail = .none
    let open: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            Button(action: open) {
                HStack(spacing: 12) {
                    Avatar(url: siteURL(player.photo), name: player.name, size: 44)
                        .overlay { Crest(url: siteURL(player.crest), size: 18).shadow(color: .black.opacity(0.35), radius: 1, y: 1).pinned(.bottomTrailing, x: 6, y: 4) }
                    VStack(alignment: .leading, spacing: 3) {
                        HStack(spacing: 6) {
                            if fresh { Circle().fill(Color.tiForeground).frame(width: 8, height: 8).accessibilityLabel("Neue News") }
                            Text(player.name).font(.system(size: 16, weight: .semibold)).tracking(-0.16).lineLimit(1)
                        }
                        if let news {
                            HStack(spacing: 6) {
                                if let pill = news.type.pill { Pill(text: pill.label, tone: pill.tone).layoutPriority(1) }
                                Text(news.title).lineLimit(1).foregroundStyle(fresh ? Color.tiForeground : Color.tiMuted)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                Text(Berlin.when(news.at, now: now)).monospacedDigit().foregroundStyle(Color.tiMuted).layoutPriority(1)
                            }
                            .font(.system(size: 13))
                        } else {
                            Text([player.club, player.card.status].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · "))
                                .font(.system(size: 13)).foregroundStyle(Color.tiMuted).lineLimit(1)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .padding(.vertical, 12)
                .contentShape(Rectangle())
            }
            .buttonStyle(.pressRow)
            switch trail {
            case .none: EmptyView()
            case .star:
                Image(systemName: "star.fill").font(.system(size: 15)).foregroundStyle(Color.tiForeground)
                    .padding(.trailing, 4).accessibilityLabel("Auf deiner Scoutliste")
            case .add(let done, let action):
                Button(action: action) {
                    Image(systemName: done ? "checkmark" : "plus").font(.system(size: 14, weight: .bold))
                        .foregroundStyle(done ? Color.tiBackground : Color.tiForeground)
                        .frame(width: 32, height: 32)
                        .background(done ? Color.tiForeground : Color.tiSurface, in: Circle())
                        .scaleEffect(done ? 1.06 : 1)
                        .animation(.easeOut(duration: 0.18), value: done)
                        // A finger needs more than the 32 points it shows; the circle still ends where the rows do.
                        .frame(width: 44, height: 44).contentShape(Rectangle())
                }
                .padding(.trailing, -6)
                .buttonStyle(.press)
                .disabled(done)
                .accessibilityLabel(done ? "\(player.name) ist auf deiner Scoutliste" : "\(player.name) scouten")
            }
        }
    }
}

/// What went wrong with the scout list, in red right where the star or the + was tapped; gone after a few seconds
/// (like the comments' message).
struct ScoutProblem: View {
    @Environment(ScoutStore.self) private var scout

    var body: some View {
        if let message = scout.message {
            Text(message).font(.system(size: 14, weight: .medium)).foregroundStyle(Color.tiRed)
                .frame(maxWidth: .infinity, alignment: .leading)
                .transition(.opacity)
                .task(id: message) {
                    try? await Task.sleep(for: .seconds(4))
                    if !Task.isCancelled { withAnimation { scout.message = nil } }
                }
        }
    }
}

/// The card's star (PlayerCard.astro): puts the player on the scout list or takes him off. The star changes for a
/// blink, then the card goes; if the change can't be saved, the star flips back and the card stays to say why.
struct ScoutButton: View {
    let playerId: Int
    /// The change is saved: the card may go.
    var saved: () -> Void = {}
    @Environment(ScoutStore.self) private var scout
    /// One tap counts: a second one while the card goes would undo it.
    @State private var busy = false

    var body: some View {
        let on = scout.contains(playerId)
        Button { toggle(to: !on) } label: {
            Label(on ? "Gescoutet" : "Scouten", systemImage: on ? "star.fill" : "star")
                .font(.system(size: 16, weight: .semibold)).frame(maxWidth: .infinity, minHeight: 48)
                .background(Color.tiSurface, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .foregroundStyle(Color.tiForeground)
        }
        .buttonStyle(.press)
        .sensoryFeedback(.success, trigger: on) { _, now in now }
    }

    private func toggle(to on: Bool) {
        guard !busy else { return }
        busy = true
        Task {
            // The card goes once the change is saved, but not before the star was seen to change.
            async let blink: Void? = try? Task.sleep(for: .milliseconds(140))
            let ok = await scout.set(playerId, on: on)
            _ = await blink
            if ok { saved() } else { busy = false }
        }
    }
}
