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
    /// `news`: his articles when already looked up (the scouting list does it once for everyone).
    init(_ p: PlayerRef, lineup: Lineup, feed: AppFeed, pos: String?, status: (String, Tone), news: [Article]? = nil) {
        let fixture = feed.fixtures.first { $0.home == lineup.club.slug || $0.away == lineup.club.slug }
        let home = fixture?.home == lineup.club.slug
        let insight = feed.insights[String(p.id)]
        self.init(
            id: p.id, name: p.name, photo: p.photo, crest: lineup.club.crest, match: lineup.matchLine, status: status.0,
            tone: "\(status.1)", pos: pos, goal: insight?.goal, scorer: insight?.scorer, card: insight?.card,
            cleanSheet: fixture?.cleanSheet.map { home ? $0.home : $0.away },
            win: fixture?.chances.map { home ? $0.home : $0.away },
            news: (news ?? feed.newsOf(player: p.id)).prefix(3).map { CardNews(id: $0.id, title: $0.headline, type: $0.newsType, at: $0.publishedAt) }
        )
    }
}

/// The card as a sheet, laid out like the website's (PlayerCard.astro, a FIFA card): the telling chance big at the
/// top, who it is at the bottom of that column, the photo in its window beside it; the other chances in one row,
/// then his news; Scouten and Schließen stay at the bottom.
struct PlayerCardView: View {
    let data: PlayerCardData
    @Environment(\.dismiss) private var dismiss

    /// A card chance from this much on is shown as a warning (PlayerCard.astro CARD_WARN).
    private static let cardWarn = 30

    private var hero: (key: String, value: Int?, label: String) {
        if let v = data.scorer { return ("scorer", v, "Scorer") }
        if let v = data.goal { return ("goal", v, "Tor") }
        if let v = data.cleanSheet { return ("cleanSheet", v, "Zu Null") }
        if let v = data.win { return ("win", v, "Sieg") }
        return ("", nil, "Scorer")
    }

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    top
                    if let match = data.match {
                        Text(match).font(.system(size: 14)).foregroundStyle(Color.tiMuted).padding(.top, 12)
                    }
                    stats
                    news
                }
                .padding(.horizontal, 24)
                .padding(.top, 28)
                .padding(.bottom, 16)
            }
            HStack(spacing: 10) {
                if let id = data.id { ScoutButton(playerId: id) }
                Button("Schließen") { dismiss() }.buttonStyle(.primary)
            }
            .padding(.horizontal, 20)
            .padding(.top, 10)
            .padding(.bottom, 8)
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .presentationCornerRadius(28)
        // A solid sheet: through iOS's glass the pitch's green ran behind the text.
        .presentationBackground(Color.tiBackground)
    }

    private var top: some View {
        HStack(alignment: .top, spacing: 14) {
            VStack(alignment: .leading, spacing: 0) {
                Text(hero.value.map { "\($0)\u{a0}%" } ?? "–")
                    .font(.system(size: 52, weight: .heavy)).tracking(-2.2).monospacedDigit()
                    .minimumScaleFactor(0.7).lineLimit(1)
                Text(hero.label).font(.system(size: 13)).foregroundStyle(Color.tiMuted).padding(.top, 5)
                Spacer(minLength: 12)
                Text(data.name).font(.system(size: 24, weight: .heavy)).tracking(-0.6).lineLimit(3).minimumScaleFactor(0.8)
                HStack(spacing: 6) {
                    if let crest = data.crest { Crest(url: siteURL(crest), size: 20) }
                    if let pos = data.pos { Text(pos).font(.system(size: 14, weight: .bold)) }
                    if let status = data.status { Pill(text: status, tone: data.statusTone, large: true) }
                }
                .padding(.top, 7)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            // The picture window of a trading card: the photo whole, from the top.
            ZStack {
                Color.tiSurface
                if data.photo == nil {
                    Text(initials(data.name)).font(.system(size: 40, weight: .bold)).foregroundStyle(Color.tiMuted)
                } else {
                    RemoteImage(url: siteURL(data.photo)).frame(width: 148, height: 151, alignment: .top)
                }
            }
            .frame(width: 148, height: 151)
            .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        }
        .fixedSize(horizontal: false, vertical: true)
    }

    /// The other chances in one row of equal columns, value over label.
    @ViewBuilder private var stats: some View {
        let all: [(key: String, value: Int?, label: String)] = [("goal", data.goal, "Tor"), ("win", data.win, "Sieg"), ("cleanSheet", data.cleanSheet, "Zu Null"), ("card", data.card, "Karte")]
        let shown = all.filter { $0.value != nil && $0.key != hero.key }
        if !shown.isEmpty {
            HStack(alignment: .top, spacing: 12) {
                ForEach(shown, id: \.key) { s in
                    VStack(alignment: .leading, spacing: 2) {
                        Text("\(s.value!)\u{a0}%")
                            .font(.system(size: 26, weight: .heavy)).tracking(-0.8).monospacedDigit()
                            .foregroundStyle(s.key == "card" && s.value! >= Self.cardWarn ? Color.tiYellow : Color.tiForeground)
                        Text(s.label).font(.system(size: 13)).foregroundStyle(Color.tiMuted)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .padding(.top, 14)
            .overlay(alignment: .top) { Rectangle().fill(Color.tiForeground.opacity(0.12)).frame(height: 1) }
            .padding(.top, 14)
        }
    }

    @ViewBuilder private var news: some View {
        if let news = data.news, !news.isEmpty {
            VStack(alignment: .leading, spacing: 0) {
                Text("News").font(.system(size: 13)).foregroundStyle(Color.tiMuted).padding(.bottom, 2)
                ForEach(Array(news.enumerated()), id: \.element.id) { index, n in
                    if index > 0 { Divider().overlay(Color.tiHairline) }
                    VStack(alignment: .leading, spacing: 4) {
                        Text(n.title).font(.system(size: 15, weight: .semibold)).lineLimit(2)
                        HStack(spacing: 6) {
                            if let pill = n.type.pill { Pill(text: pill.label, tone: pill.tone) }
                            Text(Berlin.shortDay(n.at)).font(.system(size: 12)).foregroundStyle(Color.tiMuted).monospacedDigit()
                        }
                    }
                    .padding(.vertical, 10)
                }
            }
            .padding(.top, 12)
            .overlay(alignment: .top) { Rectangle().fill(Color.tiForeground.opacity(0.12)).frame(height: 1) }
            .padding(.top, 16)
        }
    }
}
