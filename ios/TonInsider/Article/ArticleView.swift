import SwiftUI

/// One article or post (src/pages/artikel/[id].astro): who it's about, headline, date and source, banner,
/// text, a match report's grades, the link to the original, the comments.
struct ArticleView: View {
    let article: Article
    /// Parsed once, not on every redraw.
    private let blocks: [ArticleBlock]

    init(article: Article) {
        self.article = article
        blocks = articleBlocks(article.bodyHtml)
    }
    @Environment(\.openURL) private var openURL

    var body: some View {
        ScrollViewReader { scroller in
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                header.padding(.bottom, 16)
                Text(article.headline)
                    .font(.system(size: 26, weight: .bold))
                    .tracking(-0.6)
                    .padding(.bottom, 8)
                Text(byline).font(.system(size: 12)).foregroundStyle(Color.tiMuted).padding(.bottom, 24)
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
                CommentsSection(thread: article.isOwn ? .own(postId: article.id) : .liga(key: String(article.id), page: article.url))
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
            if let player = article.player, player.photo != nil || !article.isOwn {
                Avatar(url: siteURL(player.photo), name: player.name, size: 40, top: article.isOwn)
            } else if let club = article.club {
                Crest(url: siteURL(club.crest), size: 40)
            } else {
                LogoAvatar(size: 40)
            }
            VStack(alignment: .leading, spacing: 1) {
                if let player = article.player { Text(player.name).font(.system(size: 14, weight: .bold)) }
                if article.player == nil && article.club == nil { Text("TonInsider").font(.system(size: 14, weight: .bold)) }
                if let club = article.club { Text(club.name).font(.system(size: 12)).foregroundStyle(Color.tiMuted) }
            }
            .lineLimit(1)
            Spacer(minLength: 0)
            if let pill = article.newsType.pill { Pill(text: pill.label, tone: pill.tone) }
        }
    }

    private var byline: String {
        var s = "\(Berlin.full(article.publishedAt)) Uhr"
        if let author = article.author, author != article.source?.name { s += " · \(author)" }
        if let source = article.source { s += " · Quelle: \(source.name)" }
        return s
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
