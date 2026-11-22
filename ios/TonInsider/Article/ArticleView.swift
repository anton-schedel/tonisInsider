import SwiftUI

/// One article or post (src/pages/artikel/[id].astro): who it's about, headline, date and source, banner,
/// text, a match report's grades, the link to the original, the comments.
struct ArticleView: View {
    let article: Article
    /// The conversation to show, from "Deine Chats".
    var focus: Int?
    /// Parsed once, not on every redraw.
    private let blocks: [ArticleBlock]

    init(article: Article, focus: Int? = nil) {
        self.article = article
        self.focus = focus
        blocks = articleBlocks(article.bodyHtml)
    }
    @Environment(\.openURL) private var openURL
    @Environment(FeedStore.self) private var store

    var body: some View {
        ScrollViewReader { scroller in
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                header.padding(.bottom, 16)
                Text(article.headline)
                    .font(.system(size: 26, weight: .bold))
                    .tracking(-0.6)
                    .padding(.bottom, 8)
                // The link in the line's own grey, not the tint.
                Text(article.byline).font(.system(size: 12)).foregroundStyle(Color.tiMuted).tint(Color.tiMuted).padding(.bottom, 24)
                if let banner = siteURL(article.banner) {
                    let ratio = article.bannerSize.map { $0.width / $0.height } ?? 16 / 9
                    RemoteImage(url: banner, contentMode: article.bannerSize == nil ? .fill : .fit)
                        .aspectRatio(ratio, contentMode: .fit)
                        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                        .padding(.bottom, 24)
                }
                ArticleText(blocks: blocks)
                ForEach(Array((article.ratings ?? []).enumerated()), id: \.offset) { _, team in
                    RatingsPitch(team: team)
                }
                if !article.isOwn, let url = URL(string: article.url) {
                    Button { openURL(url) } label: {
                        Text("Original auf ligainsider.de ↗").font(.system(size: 14, weight: .medium))
                            .padding(.horizontal, 16).padding(.vertical, 8)
                            .background(Color.tiSurface, in: Capsule())
                    }
                    .buttonStyle(.plain)
                    .padding(.top, 24)
                }
                CommentsSection(thread: article.isOwn ? .own(postId: article.id) : .liga(key: String(article.id), page: article.url), focus: focus) { id in
                    withAnimation(.snappy(duration: 0.45)) { scroller.scrollTo(id, anchor: .center) }
                }
                .id("comments")
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 32)
        }
        #if DEBUG
        // Screenshots: -TIComments YES scrolls to the comments.
        .task {
            guard UserDefaults.standard.bool(forKey: "TIComments") else { return }
            try? await Task.sleep(for: .seconds(2))
            scroller.scrollTo("comments", anchor: .top)
        }
        #endif
        }
        .scrollDismissesKeyboard(.interactively)
        .background(Color.tiBackground)
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { Analytics.screen("article") }
    }

    private var header: some View {
        HStack(spacing: 12) {
            switch article.picture {
            case let .player(player, _, top): Avatar(url: siteURL(player.photo), name: player.name, size: 40, top: top)
            case let .crest(crest): Crest(url: siteURL(crest), size: 40)
            case .logo: LogoAvatar(size: 40)
            }
            VStack(alignment: .leading, spacing: 1) {
                if let player = article.player { Text(player.name).font(.system(size: 14, weight: .bold)) }
                if article.player == nil && article.club == nil { Text("TonInsider").font(.system(size: 14, weight: .bold)) }
                if let club = article.club {
                    let name = Text(club.name).font(.system(size: 12)).foregroundStyle(Color.tiMuted)
                    // To the club's lineup, when it has one.
                    if let slug = article.clubLineupSlug(in: store.feed) {
                        NavigationLink(value: ClubRoute(slug: slug)) { name.contentShape(Rectangle()) }.buttonStyle(.press)
                    } else {
                        name
                    }
                }
            }
            .lineLimit(1)
            Spacer(minLength: 0)
            if let pill = article.newsType.pill { Pill(text: pill.label, tone: pill.tone) }
        }
    }

}

extension Article {
    /// Date, author and source under the headline; the source's name opens its page when it has one (underlined,
    /// as on the site).
    var byline: AttributedString {
        var s = AttributedString("\(Berlin.full(publishedAt)) Uhr")
        if let author, author != source?.name { s += AttributedString(" · \(author)") }
        if let source {
            s += AttributedString(" · Quelle: ")
            var name = AttributedString(source.name)
            // A real address only: the feed has "https://LigaInsider" for LigaInsider's own articles, which leads nowhere.
            if let raw = source.url, let url = URL(string: raw), url.scheme == "https" || url.scheme == "http",
               url.host()?.contains(".") == true {
                name.link = url
                name.underlineStyle = .single
            }
            s += name
        }
        return s
    }

    /// The club's lineup page this article's club name leads to (src/pages/artikel/[id].astro clubLineupHref): our
    /// own posts have none, nor have the national teams (LigaInsider files their news under a club of their own).
    func clubLineupSlug(in feed: AppFeed?) -> String? {
        guard let club, !isOwn, feed?.lineup(slug: club.slug) != nil else { return nil }
        return club.slug
    }
}

/// The article's paragraphs and subheadings (.prose-body in global.css).
struct ArticleText: View {
    let blocks: [ArticleBlock]

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            ForEach(Array(blocks.enumerated()), id: \.offset) { index, block in
                switch block {
                case .paragraph(let text):
                    Text(text).font(.system(size: 16)).lineSpacing(5).tint(Color.tiForeground)
                case .heading(let text):
                    Text(text).font(.system(size: 18.5, weight: .bold)).padding(.top, index == 0 ? 0 : 10)
                }
            }
        }
        .textSelection(.enabled)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
