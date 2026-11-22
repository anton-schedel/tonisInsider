import SwiftUI

/// A club's page; from "Deine Chats": `comment`, the conversation to show, and `chat`, marked seen when it opens.
struct ClubRoute: Hashable { let slug: String; var comment: Int? = nil; var chat: Int? = nil }

/// Aufstellungen (src/pages/aufstellungen.astro): the coming matchday's matches; tapping a team opens its lineup.
struct LineupsView: View {
    @Environment(FeedStore.self) private var store
    private let live = LiveScoresModel.shared

    private var title: String {
        store.feed?.lineups.first { $0.matchday != nil }?.matchday.map { "\($0). Spieltag" } ?? "Aufstellungen"
    }

    var body: some View {
        ScrollView {
            if let feed = store.feed {
                // The minute decides what a card shows from kickoff on (and when its game counts as over).
                TimelineView(.everyMinute) { context in
                    VStack(alignment: .leading, spacing: 12) {
                        VStack(alignment: .leading, spacing: 0) {
                            PageHeader(title: title)
                            Text("Voraussichtliche Aufstellungen. Tippe auf ein Team.")
                                .font(.system(size: 14)).foregroundStyle(Color.tiMuted)
                        }
                        if feed.fixtures.isEmpty { EmptyNote(text: "Noch keine Aufstellungen.") }
                        ForEach(Array(feed.fixtures.enumerated()), id: \.offset) { _, fixture in
                            FixtureCard(fixture: fixture, feed: feed, live: live.state(of: fixture, now: context.date))
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.bottom, 24)
                }
            } else if store.lastError != nil {
                // First start without network: say so, with a way to try again (as News does).
                VStack(spacing: 12) {
                    PageHeader(title: title).frame(maxWidth: .infinity, alignment: .leading)
                    EmptyNote(text: "Die Aufstellungen konnten nicht geladen werden.")
                    Button("Nochmal versuchen") { Task { await store.refresh() } }.buttonStyle(.bordered)
                }
                .padding(.horizontal, 16)
            } else {
                ProgressView().padding(.top, 80)
            }
        }
        .background(Color.tiBackground)
        .navigationTitle(title)
        .tabRoot()
        .refreshable { await store.refresh() }
        .liveScores(of: store.feed?.fixtures ?? [])
        .withSiteRoutes()
    }
}

/// One match (FixtureCard.astro): both crests and names, kickoff, the likely score, and a slim bar of the chances.
/// From kickoff on the score with a red "Live", then "Ende" (`live`); on a club's page (`hero`) with the scorers.
struct FixtureCard: View {
    let fixture: Fixture
    let feed: AppFeed
    var hero = false
    /// The club whose page this is (not a link there).
    var current: String?
    /// The running or finished game, once /api/live/ has its score.
    var live: LiveState?

    var body: some View {
        VStack(spacing: 0) {
            HStack(alignment: .center, spacing: 0) {
                side(slug: fixture.home, name: fixture.homeName)
                VStack(spacing: 2) {
                    if let kickoff = fixture.kickoff {
                        Text(live.map { "\($0.home):\($0.away)" } ?? Berlin.time(kickoff))
                            .font(.system(size: hero ? 30 : 17, weight: .bold)).monospacedDigit()
                        if let live {
                            Text(live.finished ? "Ende" : "Live")
                                .font(.system(size: hero ? 13 : 11, weight: live.finished ? .regular : .semibold))
                                .foregroundStyle(live.finished ? Color.tiMuted : Color.tiRed)
                        } else {
                            Text(Berlin.shortDay(kickoff)).font(.system(size: hero ? 13 : 11)).foregroundStyle(Color.tiMuted)
                        }
                        if hero, let md = fixture.matchday { Text("\(md). Spieltag").font(.system(size: 13)).foregroundStyle(Color.tiMuted) }
                        // The tip was for before the match.
                        if !hero, live == nil, let tip = fixture.tip {
                            Text("Tipp \(tip.home):\(tip.away)").font(.system(size: 11)).foregroundStyle(Color.tiMuted).monospacedDigit()
                        }
                    } else {
                        Text("vs").foregroundStyle(Color.tiMuted)
                    }
                }
                .frame(width: hero ? 112 : 80)
                side(slug: fixture.away, name: fixture.awayName)
            }
            if hero, let scorers = live?.scorers, !(scorers.home.isEmpty && scorers.away.isEmpty) {
                // Home left and away right, in the order the goals fell.
                HStack(alignment: .top, spacing: 24) {
                    column(scorers.home, alignment: .leading)
                    column(scorers.away, alignment: .trailing)
                }
                .font(.system(size: 13)).monospacedDigit().foregroundStyle(Color.tiMuted)
                .padding(.horizontal, 12)
                .padding(.top, 16)
            }
            // Once it's over only the result counts: the pre-match odds go.
            if let c = fixture.chances, live?.finished != true {
                ChancesBar(chances: c, home: fixture.homeName, away: fixture.awayName, hero: hero, likely: hero ? fixture.tip : nil)
                    .padding(.horizontal, 12)
                    .padding(.top, hero ? 20 : 12)
            }
        }
        .padding(.horizontal, hero ? 12 : 8)
        .padding(.vertical, hero ? 24 : 16)
        .background(Color.tiSurface, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        // A score that changes in front of you dips in softly (the website's __swapText).
        .animation(.easeInOut(duration: 0.25), value: live)
    }

    private func column(_ lines: [String], alignment: HorizontalAlignment) -> some View {
        VStack(alignment: alignment, spacing: 2) {
            ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
                Text(line).multilineTextAlignment(alignment == .leading ? .leading : .trailing)
            }
        }
        .frame(maxWidth: .infinity, alignment: alignment == .leading ? .leading : .trailing)
    }

    @ViewBuilder private func side(slug: String?, name: String) -> some View {
        let lineup = slug.flatMap { feed.lineup(slug: $0) }
        let content = VStack(spacing: 8) {
            Crest(url: siteURL(lineup?.club.crest), size: hero ? 64 : 52)
            Text(name).font(.system(size: hero ? 14 : 12, weight: .semibold)).lineLimit(2).multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        if let slug, lineup != nil, slug != current {
            NavigationLink(value: ClubRoute(slug: slug)) { content }.buttonStyle(.press)
        } else {
            content
        }
    }
}

/// Home win, draw, away win as one slim bar with the numbers under it; the likelier team in the strong tone. On a
/// club's page (`hero`) the numbers are named ("Sieg", "Remis"), with the most likely score under them.
struct ChancesBar: View {
    let chances: OddsEvent.Chances
    /// The clubs' names, for VoiceOver.
    var home = ""
    var away = ""
    var hero = false
    var likely: Fixture.Score?

    var body: some View {
        let strongHome = chances.home >= chances.away
        let strong = Color.tiForeground, weak = Color.tiForeground.opacity(0.4)
        VStack(spacing: 6) {
            GeometryReader { geo in
                let total = CGFloat(max(1, chances.home + chances.draw + chances.away))
                // Two gaps of 2 between the three parts.
                let width = max(0, geo.size.width - 4)
                HStack(spacing: 2) {
                    Rectangle().fill(strongHome ? strong : weak).frame(width: max(4, width * CGFloat(chances.home) / total))
                    Rectangle().fill(Color.tiHairline).frame(width: max(4, width * CGFloat(chances.draw) / total))
                    Rectangle().fill(strongHome ? weak : strong)
                }
                .clipShape(Capsule())
            }
            .frame(height: 6)
            HStack(spacing: 0) {
                number(chances.home, bold: true).frame(maxWidth: .infinity, alignment: .leading)
                number(chances.draw, label: "Remis", bold: false).frame(maxWidth: .infinity)
                number(chances.away, bold: true).frame(maxWidth: .infinity, alignment: .trailing)
            }
            .font(.system(size: hero ? 13 : 11))
            .foregroundStyle(Color.tiMuted)
            .monospacedDigit()
            if let likely {
                Text("Wahrscheinlichstes Ergebnis \(Text("\(likely.home):\(likely.away)").fontWeight(.semibold).foregroundStyle(Color.tiForeground))\(Self.likelihood(likely))")
                    .font(.system(size: 13)).monospacedDigit().foregroundStyle(Color.tiMuted)
                    .multilineTextAlignment(.center)
                    .padding(.top, 6)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Siegchancen laut Wettquoten: \(home) \(chances.home)\u{a0}%, Unentschieden \(chances.draw)\u{a0}%, \(away) \(chances.away)\u{a0}%"
            + (likely.map { ". Wahrscheinlichstes Ergebnis \($0.home):\($0.away)\(Self.likelihood($0))" } ?? ""))
    }

    /// " (12 %)" after the most likely score; nothing from a feed stored before the percent came along.
    static func likelihood(_ score: Fixture.Score) -> String {
        score.percent.map { " (\($0)\u{a0}%)" } ?? ""
    }

    private func number(_ percent: Int, label: String = "Sieg", bold: Bool) -> Text {
        let value = Text("\(percent)\u{a0}%")
        let shown = bold ? value.fontWeight(.semibold).foregroundStyle(Color.tiForeground) : value
        return hero ? Text("\(label) \(shown)") : shown
    }
}

extension View {
    /// The pages every tab can open: an article, a club's lineup.
    func withSiteRoutes() -> some View {
        modifier(SiteRoutes())
    }
}

private struct SiteRoutes: ViewModifier {
    func body(content: Content) -> some View {
        content
            .navigationDestination(for: ArticleRoute.self) { ArticleDestination(id: $0.id, comment: $0.comment).seen(chat: $0.chat) }
            .navigationDestination(for: ClubRoute.self) { ClubDestination(slug: $0.slug, comment: $0.comment).seen(chat: $0.chat) }
            .navigationDestination(for: ChatsRoute.self) { _ in ChatsView() }
    }
}

/// Opened from "Deine Chats": that chat is seen (here and on the website).
private struct SeenChat: ViewModifier {
    let chat: Int?
    @Environment(ChatsModel.self) private var chats
    func body(content: Content) -> some View {
        content.task { if let chat { await chats.open(chat) } }
    }
}

extension View {
    func seen(chat: Int?) -> some View { modifier(SeenChat(chat: chat)) }
}

struct ArticleDestination: View {
    let id: Int
    var comment: Int?
    @Environment(FeedStore.self) private var store
    var body: some View {
        if let article = store.feed?.articles.first(where: { $0.id == id }) {
            ArticleView(article: article, focus: comment)
        } else {
            EmptyNote(text: "Diesen Beitrag gibt es nicht mehr.")
        }
    }
}

struct ClubDestination: View {
    let slug: String
    var comment: Int?
    @Environment(FeedStore.self) private var store
    var body: some View {
        if let feed = store.feed, let lineup = feed.lineup(slug: slug) {
            ClubView(lineup: lineup, feed: feed, focus: comment)
        } else {
            EmptyNote(text: "Diese Aufstellung gibt es nicht mehr.")
        }
    }
}
