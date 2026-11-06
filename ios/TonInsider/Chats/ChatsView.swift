import SwiftUI

struct ChatsRoute: Hashable {}

/// "Chats" on News (a small pill with the bubble): opens "Deine Chats"; a red number for the chats with news.
struct ChatsButton: View {
    @Environment(ChatsModel.self) private var chats

    var body: some View {
        NavigationLink(value: ChatsRoute()) {
            HStack(spacing: 6) {
                Image(systemName: "bubble.left").font(.system(size: 15, weight: .semibold))
                Text("Chats").font(.system(size: 15, weight: .semibold))
            }
                .foregroundStyle(Color.tiForeground)
                .padding(.horizontal, 13)
                .frame(height: 36)
                .background(Color.tiSurface, in: Capsule())
                .overlay(alignment: .topTrailing) {
                    if chats.badge > 0 {
                        Text(chats.badge > 9 ? "9+" : "\(chats.badge)")
                            .font(.system(size: 11, weight: .bold)).monospacedDigit()
                            .foregroundStyle(.white)
                            .padding(.horizontal, 5)
                            .frame(minWidth: 18, minHeight: 18)
                            .background(Color.tiLive, in: Capsule())
                            .overlay(Capsule().stroke(Color.tiBackground, lineWidth: 2))
                            .offset(x: 6, y: -4)
                            .transition(.scale.combined(with: .opacity))
                    }
                }
                .animation(.snappy(duration: 0.25), value: chats.badge)
        }
        .buttonStyle(.press)
        .accessibilityLabel(chats.badge > 0 ? "Deine Chats, \(chats.badge) mit Neuem" : "Deine Chats")
    }
}

/// "Deine Chats" (src/pages/chats.astro): the conversations you wrote in, newest activity first; each is read fresh
/// in place (nothing moves while the list is open); tapping one opens the article at the conversation.
struct ChatsView: View {
    @Environment(ChatsModel.self) private var model
    @Environment(Account.self) private var account
    @Environment(Tabs.self) private var tabs
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                if !account.ligaInsider || (model.loaded && !model.signedIn && model.chats.isEmpty) {
                    ChatsEmpty(title: "Mit LigaInsider anmelden",
                               text: "Deine Chats gehören zu deinem LigaInsider-Konto. So siehst du sie im Web und auf dem iPhone.") {
                        Button("Anmelden") { tabs.selected = .settings }.buttonStyle(.primary)
                    }
                } else if !model.loaded {
                    ProgressView().frame(maxWidth: .infinity).padding(.vertical, 32)
                } else if model.loadFailed {
                    ChatsEmpty(title: "Gerade nicht erreichbar", text: "Deine Chats konnten nicht geladen werden.") {
                        Button("Nochmal versuchen") { Task { await reload() } }.buttonStyle(.quiet)
                    }
                } else if model.chats.isEmpty {
                    ChatsEmpty(title: "Noch keine Chats",
                               text: "Kommentier einen Artikel oder starte eine Umfrage. Hier siehst du dann, wer antwortet und wie abgestimmt wird.") {
                        Button("Zu den News") { dismiss() }.buttonStyle(.primary)
                    }
                }
                ForEach(Array(model.chats.enumerated()), id: \.element.id) { index, chat in
                    if index > 0 { Divider().overlay(Color.tiHairline) }
                    row(chat)
                }
            }
            .padding(.horizontal, 16)
        }
        .background(Color.tiBackground)
        .navigationTitle("Deine Chats")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await reload() }
        .task { await reload() }
        .onAppear { model.isOpen = true; Analytics.screen("chats") }
        .onDisappear { model.isOpen = false }
    }

    /// Opening the list is a look for news too: the bubble's next one waits its turn.
    private func reload() async {
        await model.check(force: true)
    }

    @ViewBuilder private func row(_ chat: ChatView) -> some View {
        let target = chat.status == .over ? nil : ChatTarget(link: chat.link)
        if let route = target?.articleRoute(chat: chat.id) {
            NavigationLink(value: route) { ChatRow(chat: chat) }.buttonStyle(.pressRow)
        } else if let route = target?.clubRoute(chat: chat.id) {
            NavigationLink(value: route) { ChatRow(chat: chat) }.buttonStyle(.pressRow)
        } else {
            ChatRow(chat: chat)
        }
    }

}

/// No chats, signed out or unreachable: one calm block with what to do next (the site's [data-chats-state]).
private struct ChatsEmpty<Action: View>: View {
    let title: String
    let text: String
    @ViewBuilder let action: Action

    var body: some View {
        VStack(spacing: 0) {
            ChatsGlyph().frame(width: 52, height: 52)
            Text(title).font(.system(size: 19, weight: .semibold)).tracking(-0.3).padding(.top, 20)
            Text(text).font(.system(size: 15)).foregroundStyle(Color.tiMuted).multilineTextAlignment(.center)
                .lineSpacing(2).frame(maxWidth: 290).padding(.top, 6)
            action.frame(width: 200).padding(.top, 24)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 64)
    }
}

/// Your bubble (left) and the answer coming back in gold (the "new" dot's colour); the web draws the same in SVG.
/// The symbol's first palette layer is the right bubble.
private struct ChatsGlyph: View {
    var body: some View {
        Image(systemName: "bubble.left.and.bubble.right")
            .symbolRenderingMode(.palette)
            .foregroundStyle(Color.tiGold, Color.tiForeground)
            .font(.system(size: 40, weight: .light))
            .accessibilityHidden(true)
    }
}

private struct ChatRow: View {
    let chat: ChatView

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            if let crest = chat.place.club?.crest {
                Crest(url: siteURL(crest), size: 40)
            } else {
                LogoAvatar(size: 40)
            }
            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(chat.place.title).font(.system(size: 15, weight: chat.hasNews ? .bold : .semibold)).lineLimit(1)
                    Spacer(minLength: 0)
                    Text(Berlin.ago(chat.activityAt)).font(.system(size: 12)).foregroundStyle(Color.tiMuted).fixedSize()
                }
                Text(chat.lines.mine).font(.system(size: 13)).foregroundStyle(Color.tiMuted).lineLimit(1)
                if !chat.lines.status.isEmpty {
                    Text(chat.lines.status)
                        .font(.system(size: 13, weight: chat.hasNews ? .semibold : .regular))
                        .foregroundStyle(chat.hasNews ? Color.tiForeground : Color.tiMuted)
                        .lineLimit(1)
                        .contentTransition(.opacity)
                } else if !chat.checked {
                    // Being read: the line keeps its place, so nothing jumps when it arrives.
                    RoundedRectangle(cornerRadius: 3).fill(Color.tiSurface).frame(width: 140, height: 12).padding(.top, 3)
                }
            }
            if chat.hasNews {
                Circle().fill(Color.tiGold).frame(width: 8, height: 8).padding(.top, 16).accessibilityLabel("Neu")
            }
        }
        .padding(.vertical, 12)
        .contentShape(Rectangle())
        .animation(.snappy(duration: 0.25), value: chat)
    }
}
