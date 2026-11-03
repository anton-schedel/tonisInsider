import SwiftUI

/// The comments under an article or a club's lineup (Comments.astro / OwnComments.astro): newest threads first,
/// upvotes, replies, polls, and the box to write. LigaInsider threads need a LigaInsider login to write; our own
/// posts take a name.
struct CommentsSection: View {
    @State private var model: CommentsModel
    @Environment(Account.self) private var account
    @Environment(Tabs.self) private var tabs
    @AppStorage("ownName") private var ownName = ""
    @State private var replyTo: ThreadComment?

    init(thread: CommentThread) {
        _model = State(initialValue: CommentsModel(thread: thread))
    }

    private var isOwn: Bool { if case .own = model.thread { true } else { false } }
    private var canWrite: Bool { isOwn || account.ligaInsider }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline) {
                Text("Kommentare").font(.system(size: 20, weight: .bold)).tracking(-0.4)
                if model.total > 0 { Text("\(model.total)").foregroundStyle(Color.tiMuted).monospacedDigit() }
            }
            .padding(.bottom, 12)

            if canWrite {
                Composer(isOwn: isOwn, name: $ownName, replyTo: $replyTo) { text, poll in
                    await model.send(text: text, parent: replyTo?.id, poll: poll, name: ownName)
                }
                .padding(.bottom, 8)
            } else {
                HStack {
                    Text("Melde dich mit LigaInsider an, um mitzureden.").foregroundStyle(Color.tiMuted)
                    Spacer()
                    Button("Anmelden") { tabs.selected = .settings }.buttonStyle(.bordered)
                }
                .font(.system(size: 15))
                .padding(.bottom, 8)
            }

            if !model.loaded {
                ProgressView().frame(maxWidth: .infinity).padding(.vertical, 24)
            } else if model.comments.isEmpty {
                Text("Noch keine Kommentare.").foregroundStyle(Color.tiMuted).padding(.vertical, 16)
            }
            LazyVStack(alignment: .leading, spacing: 0) {
                ForEach(model.comments) { comment in
                    CommentRow(comment: comment, model: model, canWrite: canWrite) { replyTo = $0 }
                    ForEach(comment.replies) { reply in
                        CommentRow(comment: reply, model: model, canWrite: false) { _ in }.padding(.leading, 28)
                    }
                    Divider().overlay(Color.tiHairline)
                }
            }
            if model.hasMore {
                Button {
                    Task { await model.loadMore() }
                } label: {
                    Text(model.loadingMore ? "Lädt …" : "Weitere Kommentare laden")
                        .font(.system(size: 15, weight: .semibold)).frame(maxWidth: .infinity).padding(.vertical, 12)
                        .background(Color.tiSurface, in: RoundedRectangle(cornerRadius: 12))
                }
                .buttonStyle(.plain)
                .padding(.top, 12)
            }
        }
        .padding(.top, 32)
        .task { await model.load() }
        .overlay(alignment: .bottom) {
            if let message = model.message {
                Text(message).font(.system(size: 14, weight: .medium)).padding(.horizontal, 14).padding(.vertical, 10)
                    .background(.regularMaterial, in: Capsule())
                    .task { try? await Task.sleep(for: .seconds(3)); model.message = nil }
            }
        }
    }
}

private struct CommentRow: View {
    let comment: ThreadComment
    let model: CommentsModel
    let canWrite: Bool
    let reply: (ThreadComment) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Text(comment.user).font(.system(size: 14, weight: .semibold))
                Text("· \(relative(comment.date))").font(.system(size: 13)).foregroundStyle(Color.tiMuted)
            }
            if comment.poll == nil || comment.text != comment.poll?.question {
                Text(comment.text).font(.system(size: 15)).textSelection(.enabled)
            }
            if let poll = comment.poll {
                PollView(poll: poll) { option in Task { await model.votePoll(comment: comment.id, option: option) } }
            }
            HStack(spacing: 18) {
                Button {
                    Task { await model.toggleVote(comment.id) }
                } label: {
                    Label("\(comment.score)", systemImage: comment.voted ? "arrow.up.circle.fill" : "arrow.up.circle")
                        .monospacedDigit()
                        .foregroundStyle(comment.voted ? Color.tiGold : Color.tiMuted)
                }
                .sensoryFeedback(.impact(weight: .light), trigger: comment.voted)
                if canWrite {
                    Button("Antworten") { reply(comment) }.foregroundStyle(Color.tiMuted)
                }
            }
            .font(.system(size: 13, weight: .medium))
            .buttonStyle(.plain)
        }
        .padding(.vertical, 12)
    }

    private func relative(_ date: Date) -> String {
        let minutes = Int(Date().timeIntervalSince(date) / 60)
        if minutes < 1 { return "gerade eben" }
        if minutes < 60 { return "vor \(minutes) Min." }
        if minutes < 24 * 60 { return "vor \(minutes / 60) Std." }
        return Berlin.full(date)
    }
}

/// Options to tap; results (bars and percent) once this phone voted.
private struct PollView: View {
    let poll: ThreadPoll
    let vote: (Int) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(poll.question).font(.system(size: 15, weight: .semibold))
            ForEach(Array(poll.options.enumerated()), id: \.offset) { _, option in
                if poll.hasVoted {
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text(option.label).fontWeight(option.id != nil && option.id == poll.mine ? .semibold : .regular)
                            Spacer()
                            Text("\(option.pct)\u{a0}%").monospacedDigit().foregroundStyle(Color.tiMuted)
                        }
                        GeometryReader { geo in
                            Capsule().fill(Color.tiHairline)
                                .overlay(alignment: .leading) {
                                    Capsule().fill(Color.tiGold).frame(width: geo.size.width * CGFloat(option.pct) / 100)
                                }
                        }
                        .frame(height: 4)
                    }
                    .font(.system(size: 14))
                } else {
                    Button { if let id = option.id { vote(id) } } label: {
                        Text(option.label).font(.system(size: 14, weight: .medium)).frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 12).padding(.vertical, 9)
                            .background(Color.tiSurface, in: RoundedRectangle(cornerRadius: 10))
                    }
                    .buttonStyle(.plain)
                    .disabled(option.id == nil)
                }
            }
            Text("\(poll.total) Stimmen").font(.system(size: 12)).foregroundStyle(Color.tiMuted)
        }
        .padding(12)
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.tiHairline))
    }
}

/// The box to write: a comment, a reply (shown above) or a poll (question and 2–6 answers).
private struct Composer: View {
    let isOwn: Bool
    @Binding var name: String
    @Binding var replyTo: ThreadComment?
    let send: (String, (question: String, options: [String])?) async -> Bool

    @State private var text = ""
    @State private var polling = false
    @State private var options = ["", ""]
    @State private var busy = false
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let replyTo {
                HStack {
                    Text("Antwort an \(replyTo.user)").font(.system(size: 13)).foregroundStyle(Color.tiMuted)
                    Spacer()
                    Button("Abbrechen") { self.replyTo = nil }.font(.system(size: 13))
                }
            }
            if isOwn {
                TextField("Dein Name", text: $name).textContentType(.nickname).field()
            }
            TextField(polling ? "Deine Frage" : "Kommentar schreiben", text: $text, axis: .vertical)
                .lineLimit(1...6).focused($focused).field()
            if polling {
                ForEach(options.indices, id: \.self) { i in
                    TextField("Antwort \(i + 1)", text: $options[i]).field()
                }
                if options.count < 6 { Button("Antwort hinzufügen") { options.append("") }.font(.system(size: 14)) }
            }
            HStack {
                if replyTo == nil {
                    Button(polling ? "Keine Umfrage" : "Umfrage") { polling.toggle() }.font(.system(size: 14)).foregroundStyle(Color.tiMuted)
                }
                Spacer()
                Button {
                    busy = true
                    Task {
                        let answers = options.map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
                        let ok = await send(text.trimmingCharacters(in: .whitespacesAndNewlines), polling ? (text, answers) : nil)
                        if ok { text = ""; options = ["", ""]; polling = false; replyTo = nil; focused = false }
                        busy = false
                    }
                } label: {
                    Text("Senden").font(.system(size: 15, weight: .semibold))
                }
                .buttonStyle(.borderedProminent)
                .tint(Color.tiForeground)
                .disabled(busy || !ready)
            }
        }
    }

    private var ready: Bool {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if isOwn && name.trimmingCharacters(in: .whitespaces).count < 2 { return false }
        if polling { return t.count >= 2 && options.filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }.count >= 2 }
        return t.count >= 2
    }
}

private extension View {
    func field() -> some View {
        padding(.horizontal, 12).padding(.vertical, 10)
            .background(Color.tiSurface, in: RoundedRectangle(cornerRadius: 10))
            .font(.system(size: 15))
    }
}
