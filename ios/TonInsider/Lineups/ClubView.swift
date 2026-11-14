import SwiftUI

/// A club's page (src/pages/vereine/[slug].astro): its match, the predicted lineup on the pitch, the club's news
/// of the last week (not those about players on the pitch: they're in their cards) and the lineup's comments.
struct ClubView: View {
    let lineup: Lineup
    let feed: AppFeed
    /// The conversation to show, from "Deine Chats".
    var focus: Int? = nil

    @State private var card: PlayerCardData?
    @State private var allNews = false
    /// Kickbase points from kickoff on (src/pages/vereine/[slug].astro's live script).
    @State private var live = ClubPointsModel()
    @Environment(\.scenePhase) private var scenePhase

    private var fixture: Fixture? { feed.fixtures.first { $0.home == lineup.club.slug || $0.away == lineup.club.slug } }

    var body: some View {
        TimelineView(.everyMinute) { context in
            let news = feed.clubNews(lineup, now: context.date)
            // A button for a single hidden row isn't worth it: then all of them.
            let shown = allNews || news.count <= 6 ? news.count : 5
            ScrollViewReader { scroller in
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    if let fixture { FixtureCard(fixture: fixture, feed: feed, hero: true, current: lineup.club.slug) }
                    SectionTitle(title: "Aufstellung", detail: lineup.formation).padding(.top, 36).padding(.bottom, 12)
                    let inWindow = ClubPointsModel.matters(kickoff: lineup.kickoff, now: context.date)
                    LineupPitch(lineup: lineup, feed: feed, points: inWindow ? live.points : nil, inWindow: inWindow) { card = $0 }
                    // Everyone who came on, with his points, right under the pitch: no face to flip to find him.
                    if inWindow, let subs = live.points?.subs, !subs.isEmpty {
                        SubsList(subs: subs, points: live.points) { sub in
                            card = PlayerCardData(name: sub.name, photo: sub.photo, crest: lineup.club.crest, match: lineup.matchLine,
                                                  status: "Eingewechselt (\(sub.minute)')", tone: "yellow",
                                                  kickbaseId: sub.kb, points: live.points?.label(sub.points))
                        }
                        .padding(.top, 4)
                    }
                    SectionTitle(title: "News", detail: news.isEmpty ? nil : "\(news.count)").padding(.top, 28).padding(.bottom, 4)
                    if news.isEmpty {
                        Text("Keine weiteren News aus den letzten 7 Tagen. Die zu den Spielern oben stehen in ihrer Karte.")
                            .font(.system(size: 14)).foregroundStyle(Color.tiMuted).padding(.vertical, 16)
                    }
                    ForEach(Array(news.prefix(shown).enumerated()), id: \.element.id) { index, article in
                        NavigationLink(value: ArticleRoute(id: article.id)) {
                            ArticleRow(article: article, comments: feed.commentCounts[String(article.id)], withDay: true, now: context.date)
                        }
                        .buttonStyle(.pressRow)
                        if index < shown - 1 { Divider().overlay(Color.tiHairline) }
                    }
                    if news.count > shown {
                        Button("Alle \(news.count) News zeigen") { allNews = true }
                            .font(.system(size: 15, weight: .semibold)).frame(maxWidth: .infinity).padding(.vertical, 12)
                            .background(Color.tiSurface, in: RoundedRectangle(cornerRadius: 12)).buttonStyle(.plain).padding(.top, 8)
                    }
                    if let key = lineup.threadKey {
                        CommentsSection(thread: .liga(key: key, page: "https://www.ligainsider.de/\(lineup.club.slug)/\(lineup.club.id)/"), focus: focus) { id in
                            withAnimation(.snappy(duration: 0.45)) { scroller.scrollTo(id, anchor: .center) }
                        }
                    }
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 32)
            }
            }
        }
        .scrollDismissesKeyboard(.interactively)
        .background(Color.tiBackground)
        .navigationTitle(lineup.club.name)
        .navigationBarTitleDisplayMode(.inline)
        .playerCard($card)
        // Asked only while the app is in front (and the page open): the task stops with either.
        .task(id: scenePhase) {
            if scenePhase == .active { await live.run(slug: lineup.club.slug, kickoff: lineup.kickoff) }
        }
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
    /// From kickoff on: the club's Kickbase points (nil while the first answer is on its way).
    var points: ClubPoints? = nil
    /// Kickoff has passed (and the matchday isn't over): who really played, with points; no predictions.
    var inWindow = false
    let open: (PlayerCardData) -> Void

    private var confirmed: Bool { feed.confirmed.contains(lineup.club.id) }

    var body: some View {
        Pitch(lines: lineup.lines.map { Array($0.indices) }, mirror: true) { i, j in
            let player = lineup.lines[i][j]
            if inWindow {
                Played(player: player, play: points?.slots?[String(player.id)], points: points, pos: rowPosition(i, rows: lineup.lines.count),
                       lineup: lineup, feed: feed, confirmed: confirmed, open: open)
            } else {
                Slot(player: player, pos: rowPosition(i, rows: lineup.lines.count), lineup: lineup, feed: feed,
                     confirmed: confirmed, open: open)
            }
        }
    }

    /// Who played in a predicted starter's slot: his alternative if it was him who started; the note says when the
    /// one shown went off and who came on.
    static func played(_ p: LineupPlayer, _ play: ClubPoints.SlotPlay?) -> (shown: PlayerRef, note: String?) {
        let main = PlayerRef(id: p.id, slug: p.slug, name: p.name, photo: p.photo)
        let shown = play?.show == "alt" ? p.alternative ?? main : main
        return (shown, play?.sub.map { "bis \($0.minute)' · \($0.name)" })
    }

    /// A slot from kickoff on: one face, no "Alt:"/"statt" and no ⇄, his points under the photo.
    private struct Played: View {
        let player: LineupPlayer
        let play: ClubPoints.SlotPlay?
        let points: ClubPoints?
        let pos: String
        let lineup: Lineup
        let feed: AppFeed
        let confirmed: Bool
        let open: (PlayerCardData) -> Void

        var body: some View {
            let (shown, note) = LineupPitch.played(player, play)
            let label = points.flatMap { $0.label($0.players[String(shown.id)]) }
            Button {
                var data = PlayerCardData(shown, lineup: lineup, feed: feed, pos: pos,
                                          status: shown.id == player.id ? player.start(confirmed: confirmed) : ("Für \(player.name) in der Startelf", .green))
                data.kickbaseId = points?.ids?[String(shown.id)]
                data.points = label
                open(data)
            } label: {
                PitchFace(photo: siteURL(shown.photo), name: shown.name, note: note, noteColor: PitchColor.yellow,
                          points: label, pointsLoading: points == nil) {
                    if confirmed { PitchBadge.s11 }
                    else { PitchBadge.dot(player.status == .doubtful && shown.id == player.id ? PitchColor.yellow : PitchColor.green) }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.press)
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
            Button {
                let status = showAlternative ? ("Alternative für \(player.name)", Tone.yellow) : player.start(confirmed: confirmed)
                open(PlayerCardData(shown, lineup: lineup, feed: feed, pos: pos, status: status))
            } label: {
            PitchFace(photo: siteURL(shown.photo), name: shown.name, note: confirmed ? nil : note,
                      noteColor: player.status == .doubtful && !showAlternative ? PitchColor.yellow : .white.opacity(0.7),
                      alt: showAlternative) {
                if confirmed { PitchBadge.s11 }
                else { PitchBadge.dot(player.status == .doubtful ? PitchColor.yellow : PitchColor.green) }
                if player.alternative != nil && !confirmed {
                    PitchBadge.swap(top: false) { withAnimation(.easeInOut(duration: 0.2)) { showAlternative.toggle() } }
                }
            }
            .contentShape(Rectangle())
            }
            .buttonStyle(.press)
        }
    }
}

/// Everyone who came on for the club, under the pitch (the website's list): photo with the yellow ring, name,
/// "63' für Guirassy", his points; tapping opens his card.
struct SubsList: View {
    let subs: [ClubPoints.ClubSub]
    let points: ClubPoints?
    let open: (ClubPoints.ClubSub) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Eingewechselt").font(.system(size: 15, weight: .semibold)).padding(.bottom, 2)
            ForEach(Array(subs.enumerated()), id: \.element.id) { index, sub in
                if index > 0 { Divider().overlay(Color.tiHairline) }
                Button { open(sub) } label: {
                    HStack(spacing: 12) {
                        Avatar(url: siteURL(sub.photo), name: sub.name, size: 40)
                            .overlay(Circle().stroke(PitchColor.yellow, lineWidth: 2))
                        VStack(alignment: .leading, spacing: 2) {
                            Text(sub.name).font(.system(size: 15, weight: .semibold)).lineLimit(1)
                            Text("\(sub.minute)' für \(sub.out)").font(.system(size: 13)).foregroundStyle(Color.tiMuted).lineLimit(1)
                        }
                        Spacer(minLength: 0)
                        if let label = points?.label(sub.points) { PointsChip(label: label, style: .row) }
                    }
                    .padding(.vertical, 10)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.pressRow)
            }
        }
    }
}
