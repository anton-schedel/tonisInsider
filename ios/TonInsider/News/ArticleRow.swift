import SwiftUI

/// One post in the feed (src/components/ArticleRow.astro): picture left, headline and the meta line beside it;
/// a confirmed lineup shows its XI (and the bench under the crest) right in the row.
struct ArticleRow: View {
    let article: Article
    let comments: Int?
    var withDay = false
    let now: Date

    var body: some View {
        Group {
            if let lineup = article.confirmedXI {
                VStack(alignment: .leading, spacing: 8) {
                    HStack(alignment: .center, spacing: 8) {
                        if let club = article.club { Crest(url: siteURL(club.crest), size: 72) } else { LogoAvatar(size: 72) }
                        VStack(alignment: .leading, spacing: 0) {
                            title
                            meta
                            Text(lineup.xi).font(.system(size: 15)).padding(.top, 8)
                        }
                    }
                    if let bench = lineup.bench {
                        Text("Bank: \(bench)").font(.system(size: 13)).foregroundStyle(Color.tiMuted)
                    }
                }
            } else {
                HStack(alignment: .center, spacing: 16) {
                    picture
                    VStack(alignment: .leading, spacing: 0) {
                        title
                        meta
                    }
                }
            }
        }
        .padding(.vertical, 14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
    }

    /// Our own player news without a photo shows the club's crest, not initials.
    @ViewBuilder private var picture: some View {
        if let player = article.player, player.photo != nil || !article.isOwn {
            Avatar(url: siteURL(player.photo), name: player.name, size: 64, top: article.isOwn)
                .overlay(alignment: .bottomTrailing) {
                    if let crest = article.club?.crest {
                        Crest(url: siteURL(crest), size: 26)
                            .shadow(color: .black.opacity(0.35), radius: 1, y: 1)
                            .offset(x: 6, y: 4)
                    }
                }
        } else if let club = article.club {
            Crest(url: siteURL(club.crest), size: 64)
        } else {
            LogoAvatar(size: 64)
        }
    }

    private var title: some View {
        Text(article.headline)
            .font(.system(size: 17, weight: .semibold))
            .tracking(-0.25)
            .lineSpacing(2)
            .foregroundStyle(Color.tiForeground)
            .padding(.bottom, 4)
            .multilineTextAlignment(.leading)
    }

    private var meta: some View {
        HStack(spacing: 6) {
            if let pill = article.newsType.pill { Pill(text: pill.label, tone: pill.tone) }
            Text(article.player?.name ?? article.club?.name ?? "TonInsider").lineLimit(1).layoutPriority(-1)
            Text("· \(stamp)").monospacedDigit().fixedSize()
            Spacer(minLength: 0)
            if let comments, comments > 0 {
                Label("\(comments)", systemImage: "bubble.left").labelStyle(.titleAndIcon).monospacedDigit().fixedSize()
            }
        }
        .font(.system(size: 13))
        .foregroundStyle(Color.tiMuted)
    }

    /// The time; outside the day-grouped feed (pinned) the day too, unless it's today.
    private var stamp: String {
        let time = Berlin.time(article.publishedAt)
        guard withDay, Berlin.dayKey(article.publishedAt) != Berlin.dayKey(now) else { return time }
        return "\(Berlin.shortDay(article.publishedAt).split(separator: " ").last ?? "") \(time)"
    }
}
