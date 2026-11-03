import SwiftUI

struct ClubRoute: Hashable { let slug: String }

/// Aufstellungen (src/pages/aufstellungen.astro): the coming matchday's matches; tapping a team opens its lineup.
struct LineupsView: View {
    @Environment(FeedStore.self) private var store

    private var title: String {
        store.feed?.lineups.first { $0.matchday != nil }?.matchday.map { "\($0). Spieltag" } ?? "Aufstellungen"
    }

    var body: some View {
        ScrollView {
            if let feed = store.feed {
                VStack(alignment: .leading, spacing: 12) {
                    VStack(alignment: .leading, spacing: 0) {
                        PageHeader(title: title)
                        Text("Voraussichtliche Aufstellungen. Tippe auf ein Team.")
                            .font(.system(size: 14)).foregroundStyle(Color.tiMuted)
                    }
                    if feed.fixtures.isEmpty { EmptyNote(text: "Noch keine Aufstellungen.") }
                    ForEach(Array(feed.fixtures.enumerated()), id: \.offset) { _, fixture in
                        FixtureCard(fixture: fixture, feed: feed)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 24)
            } else {
                ProgressView().padding(.top, 80)
            }
        }
        .background(Color.tiBackground)
        .navigationTitle(title)
        .tabRoot()
        .refreshable { await store.refresh() }
        .withSiteRoutes()
    }
}

/// One match (FixtureCard.astro): both crests and names, kickoff, the likely score, and a slim bar of the chances.
struct FixtureCard: View {
    let fixture: Fixture
    let feed: AppFeed
    var hero = false
    /// The club whose page this is (not a link there).
    var current: String?

    var body: some View {
        VStack(spacing: 12) {
            HStack(alignment: .center, spacing: 0) {
                side(slug: fixture.home, name: fixture.homeName)
                VStack(spacing: 2) {
                    if let kickoff = fixture.kickoff {
                        Text(Berlin.time(kickoff)).font(.system(size: hero ? 30 : 17, weight: .bold)).monospacedDigit()
                        Text(Berlin.shortDay(kickoff)).font(.system(size: hero ? 13 : 11)).foregroundStyle(Color.tiMuted)
                        if hero, let md = fixture.matchday { Text("\(md). Spieltag").font(.system(size: 13)).foregroundStyle(Color.tiMuted) }
                        if !hero, let tip = fixture.tip {
                            Text("Tipp \(tip.home):\(tip.away)").font(.system(size: 11)).foregroundStyle(Color.tiMuted).monospacedDigit()
                        }
                    } else {
                        Text("vs").foregroundStyle(Color.tiMuted)
                    }
                }
                .frame(width: hero ? 112 : 80)
                side(slug: fixture.away, name: fixture.awayName)
            }
            if let c = fixture.chances { ChancesBar(chances: c).padding(.horizontal, 8) }
        }
        .padding(.horizontal, hero ? 12 : 8)
        .padding(.vertical, hero ? 24 : 16)
        .background(Color.tiSurface, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
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

/// Home win, draw, away win as one slim bar with the numbers under it; the likelier team in the strong tone.
struct ChancesBar: View {
    let chances: OddsEvent.Chances

    var body: some View {
        let strongHome = chances.home >= chances.away
        VStack(spacing: 4) {
            GeometryReader { geo in
                let total = CGFloat(max(1, chances.home + chances.draw + chances.away))
                HStack(spacing: 2) {
                    Capsule().fill(strongHome ? Color.tiForeground : Color.tiMuted.opacity(0.5)).frame(width: geo.size.width * CGFloat(chances.home) / total)
                    Capsule().fill(Color.tiHairline).frame(width: geo.size.width * CGFloat(chances.draw) / total)
                    Capsule().fill(strongHome ? Color.tiMuted.opacity(0.5) : Color.tiForeground)
                }
            }
            .frame(height: 4)
            HStack {
                Text("\(chances.home)\u{a0}%")
                Spacer()
                Text("X \(chances.draw)\u{a0}%").foregroundStyle(Color.tiMuted)
                Spacer()
                Text("\(chances.away)\u{a0}%")
            }
            .font(.system(size: 11, weight: .semibold))
            .monospacedDigit()
        }
    }
}

extension View {
    /// The pages every tab can open: an article, a club's lineup.
    func withSiteRoutes() -> some View {
        modifier(SiteRoutes())
    }
}

private struct SiteRoutes: ViewModifier {
    @Environment(FeedStore.self) private var store

    func body(content: Content) -> some View {
        content
            .navigationDestination(for: ArticleRoute.self) { route in
                if let article = store.feed?.articles.first(where: { $0.id == route.id }) {
                    ArticleView(article: article)
                } else {
                    EmptyNote(text: "Diesen Beitrag gibt es nicht mehr.")
                }
            }
            .navigationDestination(for: ClubRoute.self) { route in
                if let feed = store.feed, let lineup = feed.lineup(slug: route.slug) {
                    ClubView(lineup: lineup, feed: feed)
                } else {
                    EmptyNote(text: "Diese Aufstellung gibt es nicht mehr.")
                }
            }
    }
}
