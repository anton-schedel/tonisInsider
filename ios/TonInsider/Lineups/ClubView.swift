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
    /// The match's live score for the card on top.
    private let scores = LiveScoresModel.shared
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
                    if let fixture {
                        FixtureCard(fixture: fixture, feed: feed, hero: true, current: lineup.club.slug,
                                    live: scores.state(of: fixture, now: context.date))
                    }
                    SectionTitle(title: "Aufstellung", detail: lineup.formation).padding(.top, 36).padding(.bottom, 12)
                    // From kickoff on: who really played, with points. Unless Kickbase has no answer for this club
                    // (it can't be mapped, or Kickbase is down): then the pitch stays as before kickoff, without
                    // placeholders that may never fill.
                    let inWindow = ClubPointsModel.matters(kickoff: lineup.kickoff, now: context.date) && !live.failed
                    LineupPitch(lineup: lineup, feed: feed, points: inWindow ? live.points : nil, inWindow: inWindow, now: context.date) { card = $0 }
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
        // Asked only while the app is in front (and the page open): the task stops with either. Anew when the feed
        // brings a kickoff (or another one) while the page is open: the asking is for that match.
        .task(id: ClubPointsModel.Asking(active: scenePhase == .active, kickoff: lineup.kickoff)) {
            if scenePhase == .active { await live.run(slug: lineup.club.slug, kickoff: lineup.kickoff) }
        }
        .liveScores(of: fixture.map { [$0] } ?? [])
        #if DEBUG
        .task {
            // Screenshots: -TICard <row> opens the first player of that row's card.
            let row = UserDefaults.standard.integer(forKey: "TICard")
            if row > 0, row <= lineup.lines.count, let p = lineup.lines[row - 1].first {
                var data = PlayerCardData(PlayerRef(id: p.id, slug: p.slug, name: p.name, photo: p.photo), lineup: lineup, feed: feed,
                                          pos: rowPosition(row - 1, rows: lineup.lines.count), status: p.start(confirmed: feed.confirmed.contains(lineup.club.id)))
                // From kickoff on, as a tap would: with his points once they're in.
                if ClubPointsModel.matters(kickoff: lineup.kickoff, now: .now) {
                    for _ in 0..<50 where live.points == nil { try? await Task.sleep(for: .milliseconds(100)) }
                    data.kickbaseId = live.points?.ids?[String(p.id)]
                    data.points = live.points.flatMap { $0.label($0.players[String(p.id)]) }
                }
                card = data
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
    /// For the newspaper on a photo: news of the last 3 days.
    var now: Date = .now
    let open: (PlayerCardData) -> Void

    private var confirmed: Bool { feed.confirmed.contains(lineup.club.id) }

    var body: some View {
        let fresh = feed.freshNewsPlayers(now: now)
        VStack(spacing: 0) {
            Pitch(lines: lineup.lines.map { Array($0.indices) }, mirror: true) { i, j in
                let player = lineup.lines[i][j]
                if inWindow {
                    Played(player: player, play: points?.slots?[String(player.id)], points: points, pos: rowPosition(i, rows: lineup.lines.count),
                           lineup: lineup, feed: feed, confirmed: confirmed, fresh: fresh, open: open)
                } else {
                    Slot(player: player, pos: rowPosition(i, rows: lineup.lines.count), lineup: lineup, feed: feed,
                         confirmed: confirmed, fresh: fresh, open: open)
                }
            }
            PitchLegend(items: Self.legend(lineup, confirmed: confirmed, fresh: fresh))
        }
    }

    /// What the marks mean (Pitch.astro's legend): the dots until LigaInsider confirms the XI, the newspaper only
    /// when someone on the pitch (an alternative too) has fresh news.
    static func legend(_ lineup: Lineup, confirmed: Bool, fresh: Set<Int>) -> [PitchLegend.Item] {
        var items: [PitchLegend.Item] = confirmed
            ? [.init("Startelf bestätigt", mark: .s11)]
            : [.init("Gesetzt", mark: .dot(.green)), .init("Fraglich", mark: .dot(.yellow))]
        let anyNews = lineup.lines.joined().contains { fresh.contains($0.id) || ($0.alternative.map { fresh.contains($0.id) } ?? false) }
        if anyNews { items.append(.init("Neue News", mark: .news)) }
        items.append(.init("Tippen für Prognose"))
        return items
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
        let fresh: Set<Int>
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
                    if fresh.contains(shown.id) { PitchBadge.news }
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
        let fresh: Set<Int>
        let open: (PlayerCardData) -> Void
        @State private var showAlternative = false

        var body: some View {
            let main = PlayerRef(id: player.id, slug: player.slug, name: player.name, photo: player.photo)
            let shown = showAlternative ? player.alternative ?? main : main
            let note: String? = showAlternative ? "statt \(player.name)"
                : player.status == .doubtful ? (player.statusLabel ?? "Fraglich") : player.alternative.map { "Alt: \($0.name)" }
            Button {
                let status = showAlternative ? (player.alternativeStatus, Tone.yellow) : player.start(confirmed: confirmed)
                open(PlayerCardData(shown, lineup: lineup, feed: feed, pos: pos, status: status))
            } label: {
            PitchFace(photo: siteURL(shown.photo), name: shown.name, note: confirmed ? nil : note,
                      noteColor: player.status == .doubtful && !showAlternative ? PitchColor.yellow : .white.opacity(0.7),
                      alt: showAlternative) {
                // The one shown: his own fresh news (the website's alternative face has its own badge).
                if fresh.contains(shown.id) { PitchBadge.news }
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
/// "63' für Guirassy", the part of the match he was on (a slim line filled from his minute to the end: 158 points
/// in 71 minutes read differently from 0 in 2), his points; tapping opens his card. Name and points keep their
/// widths, so the lines stand under each other.
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
                        .frame(width: 148, alignment: .leading)
                        played(from: Self.playedFrom(minute: sub.minute))
                        HStack(spacing: 0) {
                            if let label = points?.label(sub.points) { PointsChip(label: label, style: .row) }
                        }
                        .frame(width: 54, alignment: .trailing)
                    }
                    .padding(.vertical, 10)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.pressRow)
            }
        }
    }

    /// Where a substitute's line starts, as a part of the 90 minutes (.sub-played's --from): one who came on in
    /// stoppage time still shows a sliver.
    static func playedFrom(minute: Int) -> Double {
        min(0.98, max(0, Double(minute) / 90))
    }

    /// The match as a hairline, his part of it filled (global.css .sub-played).
    private func played(from: Double) -> some View {
        GeometryReader { geo in
            RoundedRectangle(cornerRadius: 2).fill(Color.tiMuted.opacity(0.55))
                .frame(width: geo.size.width * (1 - from))
                .frame(maxWidth: .infinity, alignment: .trailing)
        }
        .frame(minWidth: 40, maxWidth: .infinity)
        .frame(height: 4)
        .background(Color.tiHairline, in: RoundedRectangle(cornerRadius: 2))
        .accessibilityHidden(true)
    }
}

extension LineupPlayer {
    /// The line on the card of the one who may play in his place (Pitch.astro).
    var alternativeStatus: String { "Alternative zu \(name)" }
}

extension AppFeed {
    /// The players with news from the last 3 days that are out: they carry the newspaper on a pitch photo, older
    /// news stay in the card only (src/lib/card.ts hasFreshNews, FRESH_NEWS_MS).
    func freshNewsPlayers(now: Date) -> Set<Int> {
        let since = now.addingTimeInterval(-3 * 86_400)
        return Set(articles.lazy.filter { $0.publishedAt <= now && $0.publishedAt > since }.compactMap { $0.player?.id })
    }
}
