import SwiftUI

struct ChatsRoute: Hashable {}

/// The bubble on News (left of the wordmark): opens "Deine Chats"; a red number for the chats with news.
struct ChatsButton: View {
    @Environment(ChatsModel.self) private var chats

    var body: some View {
        NavigationLink(value: ChatsRoute()) {
            Image(systemName: "bubble.left")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Color.tiForeground)
                .frame(width: 36, height: 36)
                .background(Color.tiSurface, in: Circle())
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

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                if !account.ligaInsider {
                    note("Melde dich mit LigaInsider an, damit deine Chats hier auftauchen.") {
                        Button("Anmelden") { tabs.selected = .settings }.buttonStyle(.primary).frame(width: 140)
                    }
                } else if !model.loaded {
                    ProgressView().frame(maxWidth: .infinity).padding(.vertical, 32)
                } else if model.loadFailed {
                    note("Deine Chats konnten gerade nicht geladen werden.") {
                        Button("Nochmal versuchen") { Task { await reload() } }.buttonStyle(.quiet).frame(width: 200)
                    }
                } else if model.chats.isEmpty {
                    note("Noch keine Chats. Wenn du kommentierst oder eine Umfrage startest, findest du sie hier wieder.") { EmptyView() }
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

    private func note(_ text: String, @ViewBuilder action: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(text).font(.system(size: 15)).foregroundStyle(Color.tiMuted)
            action()
        }
        .padding(.vertical, 24)
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
