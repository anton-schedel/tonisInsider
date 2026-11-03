import SwiftUI

struct ArticleRoute: Hashable { let id: Int }

/// The News tab (src/pages/index.astro): pinned posts on top, then the feed by day under slim sticky bands.
struct NewsView: View {
    @Environment(FeedStore.self) private var store

    var body: some View {
        // The clock moves posts out of their pin and scheduled ones into the feed while the screen is open.
        TimelineView(.everyMinute) { context in
            content(now: context.date)
        }
        .background(Color.tiBackground)
        .navigationTitle("News")
        .refreshable { await store.refresh() }
        .navigationDestination(for: ArticleRoute.self) { route in
            if let article = store.feed?.articles.first(where: { $0.id == route.id }) {
                ArticleView(article: article)
            } else {
                EmptyNote(text: "Diesen Beitrag gibt es nicht mehr.")
            }
        }
    }

    @ViewBuilder private func content(now: Date) -> some View {
        if let feed = store.feed {
            let pinned = feed.pinnedArticles(now: now)
            let groups = feed.dayGroups(now: now)
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0, pinnedViews: [.sectionHeaders]) {
                    if !pinned.isEmpty {
                        Section {
                            rows(pinned, feed: feed, withDay: true, now: now)
                        } header: {
                            DayBand { Label("Angeheftet", systemImage: "pin").labelStyle(.titleAndIcon) }
                        }
                    }
                    if groups.isEmpty && pinned.isEmpty { EmptyNote(text: "Noch keine News.") }
                    ForEach(Array(groups.enumerated()), id: \.element.day) { index, group in
                        Section {
                            rows(group.items, feed: feed, withDay: false, now: now)
                        } header: {
                            // Today's band only under pinned posts, so they don't read as today's (global.css).
                            if index > 0 || !pinned.isEmpty || !Berlin.dayLabel(group.items[0].publishedAt, now: now).hasPrefix("Heute") {
                                DayBand { dayTitle(group.items[0].publishedAt, now: now) }
                            }
                        }
                    }
                }
                .padding(.horizontal, 16)
            }
        } else if store.lastError != nil {
            VStack(spacing: 12) {
                EmptyNote(text: "Die News konnten nicht geladen werden.")
                Button("Nochmal versuchen") { Task { await store.refresh() } }.buttonStyle(.bordered)
            }
            .frame(maxHeight: .infinity)
        } else {
            SkeletonFeed()
        }
    }

    private func rows(_ articles: [Article], feed: AppFeed, withDay: Bool, now: Date) -> some View {
        ForEach(Array(articles.enumerated()), id: \.element.id) { index, article in
            NavigationLink(value: ArticleRoute(id: article.id)) {
                ArticleRow(article: article, comments: feed.commentCounts[String(article.id)], withDay: withDay, now: now)
            }
            .buttonStyle(.plain)
            if index < articles.count - 1 { Divider().overlay(Color.tiHairline) }
        }
    }

    private func dayTitle(_ date: Date, now: Date) -> Text {
        let parts = Berlin.dayLabel(date, now: now).components(separatedBy: " · ")
        guard parts.count == 2 else { return Text(parts[0]) }
        return Text("\(parts[0]) ") + Text(parts[1]).fontWeight(.regular).foregroundStyle(Color.tiMuted)
    }
}

/// A day's slim band: soft grey fading out to the right; it stays on top while its posts scroll by.
struct DayBand<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        HStack(spacing: 6) { content }
            .font(.system(size: 14, weight: .semibold))
            .frame(maxWidth: .infinity, minHeight: 32, alignment: .leading)
            .padding(.horizontal, 16)
            .background {
                LinearGradient(stops: [.init(color: Color.tiSurface.opacity(0.65), location: 0.35), .init(color: .clear, location: 1)],
                               startPoint: .leading, endPoint: .trailing)
                    .background(.ultraThinMaterial.opacity(0.6))
            }
            .padding(.horizontal, -16)
    }
}

/// Grey placeholder rows while there is no feed on the phone yet (first launch).
private struct SkeletonFeed: View {
    var body: some View {
        VStack(spacing: 0) {
            ForEach(0..<7, id: \.self) { _ in
                HStack(spacing: 16) {
                    Circle().fill(Color.tiSurface).frame(width: 64, height: 64)
                    VStack(alignment: .leading, spacing: 8) {
                        RoundedRectangle(cornerRadius: 4).fill(Color.tiSurface).frame(height: 16)
                        RoundedRectangle(cornerRadius: 4).fill(Color.tiSurface).frame(width: 160, height: 12)
                    }
                }
                .padding(.vertical, 14)
            }
            Spacer()
        }
        .padding(.horizontal, 16)
    }
}
