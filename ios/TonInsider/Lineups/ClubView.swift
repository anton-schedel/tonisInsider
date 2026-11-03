import SwiftUI

/// A club's page (src/pages/vereine/[slug].astro): its match, the predicted lineup on the pitch, the club's news
/// of the last week (not those about players on the pitch: they're in their cards) and the lineup's comments.
struct ClubView: View {
    let lineup: Lineup
    let feed: AppFeed

    @State private var card: PlayerCardData?
    @State private var allNews = false

    private var fixture: Fixture? { feed.fixtures.first { $0.home == lineup.club.slug || $0.away == lineup.club.slug } }

    var body: some View {
        TimelineView(.everyMinute) { context in
            let news = feed.clubNews(lineup, now: context.date)
            // A button for a single hidden row isn't worth it: then all of them.
            let shown = allNews || news.count <= 6 ? news.count : 5
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    if let fixture { FixtureCard(fixture: fixture, feed: feed, hero: true, current: lineup.club.slug) }
                    SectionTitle(title: "Aufstellung", detail: lineup.formation).padding(.top, 36).padding(.bottom, 12)
                    LineupPitch(lineup: lineup, feed: feed) { card = $0 }
                    SectionTitle(title: "News", detail: news.isEmpty ? nil : "\(news.count)").padding(.top, 28).padding(.bottom, 4)
                    if news.isEmpty {
                        Text("Keine weiteren News aus den letzten 7 Tagen. Die zu den Spielern oben stehen in ihrer Karte.")
                            .font(.system(size: 14)).foregroundStyle(Color.tiMuted).padding(.vertical, 16)
                    }
                    ForEach(Array(news.prefix(shown).enumerated()), id: \.element.id) { index, article in
                        NavigationLink(value: ArticleRoute(id: article.id)) {
                            ArticleRow(article: article, comments: feed.commentCounts[String(article.id)], withDay: true, now: context.date)
                        }
                        .buttonStyle(.plain)
                        if index < shown - 1 { Divider().overlay(Color.tiHairline) }
                    }
                    if news.count > shown {
                        Button("Alle \(news.count) News zeigen") { allNews = true }
                            .font(.system(size: 15, weight: .semibold)).frame(maxWidth: .infinity).padding(.vertical, 12)
                            .background(Color.tiSurface, in: RoundedRectangle(cornerRadius: 12)).buttonStyle(.plain).padding(.top, 8)
                    }
                    if let key = lineup.threadKey {
                        CommentsSection(thread: .liga(key: key, page: "https://www.ligainsider.de/\(lineup.club.slug)/\(lineup.club.id)/"))
                    }
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 32)
            }
        }
        .background(Color.tiBackground)
        .navigationTitle(lineup.club.name)
        .navigationBarTitleDisplayMode(.inline)
        .sheet(item: $card) { PlayerCardView(data: $0) }
        #if DEBUG
        .task {
            // Screenshots: -TICard <row> opens the first player of that row's card.
            let row = UserDefaults.standard.integer(forKey: "TICard")
            if row > 0, row <= lineup.lines.count, let p = lineup.lines[row - 1].first {
                card = PlayerCardData(PlayerRef(id: p.id, slug: p.slug, name: p.name, photo: p.photo), lineup: lineup, feed: feed,
                                      pos: rowPosition(row - 1, rows: lineup.lines.count), status: p.start(confirmed: feed.confirmed.contains(lineup.club.id)))
            }
        }
        #endif
    }
}

/// A section's heading with a muted detail on the right (SectionHead.astro).
struct SectionTitle: View {
    let title: String
    var detail: String?

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title).font(.system(size: 20, weight: .bold)).tracking(-0.4)
            Spacer()
            if let detail { Text(detail).font(.system(size: 15)).foregroundStyle(Color.tiMuted).monospacedDigit() }
        }
    }
}

/// The predicted XI on the pitch (Pitch.astro): a dot on each photo (green set, yellow doubtful), a doubtful
/// player's reason, and ⇄ where LigaInsider names an alternative — tapping flips to him; tapping a player
/// otherwise opens his card.
struct LineupPitch: View {
    let lineup: Lineup
    let feed: AppFeed
    let open: (PlayerCardData) -> Void

    private var confirmed: Bool { feed.confirmed.contains(lineup.club.id) }

    var body: some View {
        Pitch(lines: lineup.lines.map { Array($0.indices) }, mirror: true) { i, j in
            Slot(player: lineup.lines[i][j], pos: rowPosition(i, rows: lineup.lines.count), lineup: lineup, feed: feed,
                 confirmed: confirmed, open: open)
        }
    }


    private struct Slot: View {
        let player: LineupPlayer
        let pos: String
        let lineup: Lineup
        let feed: AppFeed
        let confirmed: Bool
        let open: (PlayerCardData) -> Void
        @State private var showAlternative = false

        var body: some View {
            let main = PlayerRef(id: player.id, slug: player.slug, name: player.name, photo: player.photo)
            let shown = showAlternative ? player.alternative ?? main : main
            let note: String? = showAlternative ? "statt \(player.name)"
                : player.status == .doubtful ? (player.statusLabel ?? "Fraglich") : player.alternative.map { "Alt: \($0.name)" }
            PitchFace(photo: siteURL(shown.photo), name: shown.name, note: confirmed ? nil : note,
                      noteColor: player.status == .doubtful && !showAlternative ? PitchColor.yellow : .white.opacity(0.7),
                      alt: showAlternative) {
                if confirmed { PitchBadge.s11 }
                else { PitchBadge.dot(player.status == .doubtful ? PitchColor.yellow : PitchColor.green) }
                if player.alternative != nil && !confirmed {
                    PitchBadge.swap(top: false)
                        .contentShape(Rectangle().inset(by: -8))
                        .onTapGesture { withAnimation(.easeInOut(duration: 0.2)) { showAlternative.toggle() } }
                }
            }
            .contentShape(Rectangle())
            .onTapGesture {
                let status = showAlternative ? ("Alternative für \(player.name)", Tone.yellow) : player.start(confirmed: confirmed)
                open(PlayerCardData(shown, lineup: lineup, feed: feed, pos: pos, status: status))
            }
        }
    }
}
