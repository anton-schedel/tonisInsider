import SwiftUI

/// What a player's card shows (src/lib/card.ts CardData): from a club's pitch or Mein Team.
struct PlayerCardData: Codable, Hashable, Identifiable, Sendable {
    /// LigaInsider player id (lets the card put him on the scout list).
    var id: Int?
    var name: String
    var photo: String?
    var crest: String?
    /// "vs Bayern · Sa. 07.11. 15:30"
    var match: String?
    var status: String?
    var tone: String?
    var pos: String?
    var goal: Int?
    var scorer: Int?
    var card: Int?
    var cleanSheet: Int?
    var win: Int?
    var news: [CardNews]?

    struct CardNews: Codable, Hashable, Sendable { var id: Int; var title: String; var type: NewsType; var at: Date }

    var statusTone: Tone {
        switch tone { case "green": .green; case "yellow": .yellow; case "red": .red; default: .grey }
    }
}

extension PlayerCardData {
    /// A predicted starter (or his alternative) on a club's pitch.
    init(_ p: PlayerRef, lineup: Lineup, feed: AppFeed, pos: String?, status: (String, Tone)) {
        let fixture = feed.fixtures.first { $0.home == lineup.club.slug || $0.away == lineup.club.slug }
        let home = fixture?.home == lineup.club.slug
        let insight = feed.insights[String(p.id)]
        self.init(
            id: p.id, name: p.name, photo: p.photo, crest: lineup.club.crest, match: lineup.matchLine, status: status.0,
            tone: "\(status.1)", pos: pos, goal: insight?.goal, scorer: insight?.scorer, card: insight?.card,
            cleanSheet: fixture?.cleanSheet.map { home ? $0.home : $0.away },
            win: fixture?.chances.map { home ? $0.home : $0.away },
            news: feed.newsOf(player: p.id).prefix(3).map { CardNews(id: $0.id, title: $0.headline, type: $0.newsType, at: $0.publishedAt) }
        )
    }
}

/// The card as a sheet: like a FIFA card, the most telling chance big, the others in a row, then status and news.
struct PlayerCardView: View {
    let data: PlayerCardData

    private var hero: (value: Int?, label: String) {
        if let v = data.scorer { return (v, "Scorer") }
        if let v = data.goal { return (v, "Tor") }
        if let v = data.cleanSheet { return (v, "Zu Null") }
        if let v = data.win { return (v, "Sieg") }
        return (nil, "Scorer")
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(hero.value.map { "\($0)\u{a0}%" } ?? "–").font(.system(size: 34, weight: .bold)).monospacedDigit()
                        Text(hero.label).font(.system(size: 13, weight: .semibold)).foregroundStyle(Color.tiMuted)
                        if let pos = data.pos { Text(pos).font(.system(size: 13, weight: .semibold)).padding(.top, 6) }
                        if let crest = data.crest { Crest(url: siteURL(crest), size: 28).padding(.top, 4) }
                    }
                    Spacer()
                    Avatar(url: siteURL(data.photo), name: data.name, size: 112)
                }
                VStack(spacing: 6) {
                    Text(data.name).font(.system(size: 24, weight: .bold)).multilineTextAlignment(.center)
                    if let match = data.match { Text(match).font(.system(size: 14)).foregroundStyle(Color.tiMuted) }
                    if let status = data.status { Pill(text: status, tone: data.statusTone) }
                }
                let stats: [(Int?, String)] = [(data.goal, "Tor"), (data.win, "Sieg"), (data.cleanSheet, "Zu Null"), (data.card, "Karte")]
                if stats.contains(where: { $0.0 != nil }) {
                    HStack {
                        ForEach(Array(stats.enumerated()), id: \.offset) { _, s in
                            VStack(spacing: 2) {
                                Text(s.0.map { "\($0)\u{a0}%" } ?? "–").font(.system(size: 17, weight: .bold)).monospacedDigit()
                                Text(s.1).font(.system(size: 12)).foregroundStyle(Color.tiMuted)
                            }
                            .frame(maxWidth: .infinity)
                        }
                    }
                    .padding(.vertical, 10)
                    .overlay(alignment: .top) { Divider().overlay(Color.tiHairline) }
                    .overlay(alignment: .bottom) { Divider().overlay(Color.tiHairline) }
                }
                if let news = data.news, !news.isEmpty {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("News").font(.system(size: 13, weight: .semibold)).foregroundStyle(Color.tiMuted)
                        ForEach(news, id: \.id) { n in
                            VStack(alignment: .leading, spacing: 4) {
                                    Text(n.title).font(.system(size: 15, weight: .semibold)).multilineTextAlignment(.leading)
                                    HStack(spacing: 6) {
                                        if let pill = n.type.pill { Pill(text: pill.label, tone: pill.tone) }
                                        Text(Berlin.shortDay(n.at)).font(.system(size: 13)).foregroundStyle(Color.tiMuted)
                                    }
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                }
                if let id = data.id { ScoutButton(playerId: id) }
            }
            .padding(20)
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }
}
