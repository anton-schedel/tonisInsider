import SwiftUI

/// The comments under an article or a club's lineup (Comments.astro / OwnComments.astro): newest threads first,
/// upvotes, replies, polls, and the box to write. LigaInsider threads need a LigaInsider login to write; our own
/// posts take a name.
struct CommentsSection: View {
    @State private var model: CommentsModel
    @Environment(Account.self) private var account
    @Environment(Tabs.self) private var tabs
    @AppStorage("ownName") private var ownName = ""

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
                Composer(isOwn: isOwn, name: $ownName) { text, poll in
                    await model.send(text: text, poll: poll, name: ownName)
                }
                .padding(.bottom, 8)
            } else {
                HStack {
                    Text("Melde dich mit LigaInsider an, um mitzureden.").foregroundStyle(Color.tiMuted)
                    Spacer()
                    Button("Anmelden") { tabs.selected = .settings }.buttonStyle(.primary).frame(width: 120)
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
                ForEach(Array(model.comments.enumerated()), id: \.element.id) { index, comment in
                    if index > 0 { Divider().overlay(Color.tiHairline) }
                    VStack(alignment: .leading, spacing: 12) {
                        CommentRow(comment: comment, model: model, reply: false, canWrite: canWrite, name: $ownName)
                        if !comment.replies.isEmpty {
                            VStack(alignment: .leading, spacing: 12) {
                                ForEach(comment.replies) { CommentRow(comment: $0, model: model, reply: true, canWrite: canWrite, name: $ownName) }
                            }
                            .padding(.leading, 12)
                            .overlay(alignment: .leading) { Rectangle().fill(Color.tiHairline).frame(width: 2) }
                            .padding(.leading, 15)
                        }
                    }
                    .padding(.vertical, 14)
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
    let reply: Bool
    /// Our own posts for everyone, LigaInsider's with a LigaInsider login: reply and vote in polls.
    let canWrite: Bool
    @Binding var name: String
    @State private var replying = false

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 10) {
                    Text(initials(comment.user).isEmpty ? "?" : initials(comment.user))
                        .font(.system(size: reply ? 10 : 11, weight: .semibold)).foregroundStyle(Color.tiMuted)
                        .frame(width: reply ? 28 : 32, height: reply ? 28 : 32)
                        .background(Color.tiSurface, in: Circle())
                    Text(comment.user).font(.system(size: 14, weight: .semibold)).lineLimit(1)
                    Text(relative(comment.date)).font(.system(size: 12)).foregroundStyle(Color.tiMuted).fixedSize()
                }
                if comment.poll == nil || comment.text != comment.poll?.question {
                    Text(comment.text).font(.system(size: 15)).lineSpacing(3).textSelection(.enabled)
                }
                if let poll = comment.poll {
                    PollView(poll: poll, canVote: canWrite) { option in Task { await model.votePoll(comment: comment.id, option: option) } }
                        .padding(.top, 4)
                }
                // Replies go under the thread's comment (LigaInsider has one level).
                if canWrite && !reply {
                    Button(replying ? "Abbrechen" : "Antworten") { withAnimation(.snappy(duration: 0.25)) { replying.toggle() } }
                        .font(.system(size: 12, weight: .medium)).foregroundStyle(Color.tiMuted).buttonStyle(.plain)
                        .padding(.vertical, 6).contentShape(Rectangle())
                }
                if replying {
                    ReplyField(isOwn: { if case .own = model.thread { true } else { false } }(), name: $name, to: comment.user) { text in
                        let ok = await model.send(text: text, parent: comment.id, name: name)
                        if ok { withAnimation(.snappy(duration: 0.25)) { replying = false } }
                        return ok
                    }
                    .transition(.opacity)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            VoteButton(voted: comment.voted, score: comment.score) { Task { await model.toggleVote(comment.id) } }
        }
    }

    private func relative(_ date: Date) -> String {
        let minutes = Int(Date().timeIntervalSince(date) / 60)
        if minutes < 1 { return "gerade eben" }
        if minutes < 60 { return "vor \(minutes) Min." }
        if minutes < 24 * 60 { return "vor \(minutes / 60) Std." }
        return Berlin.full(date)
    }
}

/// ▲ with the count, a finger-sized grey tile; filled once this phone voted (.vote-btn in global.css).
private struct VoteButton: View {
    let voted: Bool
    let score: Int
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 2) {
                Image(systemName: "arrowtriangle.up.fill").font(.system(size: 12, weight: .bold))
                    .symbolEffect(.bounce, value: voted)
                if score != 0 { Text("\(score)").font(.system(size: 12, weight: .bold)).monospacedDigit() }
            }
            .frame(width: 44, height: 48)
            .foregroundStyle(voted ? Color.tiBackground : Color.tiForeground)
            .background(voted ? Color.tiForeground : Color.tiSurface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(voted ? "Deine Stimme" : "Hochvoten")
        .sensoryFeedback(.impact(weight: .light), trigger: voted)
    }
}

/// A poll as the site shows it (commentUi.ts renderPoll): the results always — a bar per answer, the leading one a
/// little darker, the percent on the right — and, until this phone voted, each answer a button. Its own answer gets ✓.
private struct PollView: View {
    let poll: ThreadPoll
    var canVote = true
    let vote: (Int) -> Void

    var body: some View {
        let best = poll.options.map(\.pct).max() ?? 0
        VStack(alignment: .leading, spacing: 6) {
            Text(poll.question).font(.system(size: 14, weight: .semibold)).padding(.bottom, 2)
            ForEach(Array(poll.options.enumerated()), id: \.offset) { _, option in
                let mine = option.id != nil && option.id == poll.mine
                let row = HStack {
                    Text(option.label + (mine ? " ✓" : "")).fontWeight(mine ? .semibold : .regular)
                    Spacer(minLength: 8)
                    Text("\(option.pct)\u{a0}%").fontWeight(.semibold).monospacedDigit()
                }
                .font(.system(size: 15))
                .padding(.horizontal, 12).frame(minHeight: 44)
                .background(alignment: .leading) {
                    GeometryReader { geo in
                        Rectangle()
                            .fill(option.pct == best && best > 0 ? Color.tiForeground.opacity(0.16) : Color.tiHairline)
                            .frame(width: geo.size.width * CGFloat(option.pct) / 100)
                    }
                }
                .background(Color.tiBackground)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay { if mine { RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Color.tiForeground, lineWidth: 1.5) } }
                if !poll.hasVoted && canVote, let id = option.id {
                    Button { vote(id) } label: { row.contentShape(Rectangle()) }.buttonStyle(.plain)
                } else {
                    row
                }
            }
            Text("\(poll.total) \(poll.total == 1 ? "Stimme" : "Stimmen")").font(.system(size: 12)).foregroundStyle(Color.tiMuted)
        }
        .padding(12)
        .background(Color.tiSurface, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .animation(.timingCurve(0.22, 1, 0.36, 1, duration: 0.3), value: poll)
    }
}

/// The box to write (CommentComposer.astro): the text, or a poll's question and answers; below it Kommentar |
/// Umfrage and Senden. Switching between the two grows or shrinks the box smoothly.
private struct Composer: View {
    let isOwn: Bool
    @Binding var name: String
    let send: (String, (question: String, options: [String])?) async -> Bool

    private enum Mode: Hashable { case text, poll }
    @State private var mode = Mode.text
    @State private var text = ""
    @State private var question = ""
    @State private var options = ["", ""]
    @State private var busy = false
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if isOwn { TextField("Dein Name", text: $name).textContentType(.nickname).siteField() }
            if mode == .text {
                TextField("Was sagst du dazu?", text: $text, axis: .vertical)
                    .lineLimit(3...8).focused($focused).siteField()
                    .transition(.opacity)
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    TextField("Frage der Umfrage…", text: $question).siteField()
                    ForEach(options.indices, id: \.self) { i in TextField("Antwort…", text: $options[i]).siteField() }
                    if options.count < 6 {
                        Button("Weitere Antwort") { withAnimation(.snappy) { options.append("") } }
                            .font(.system(size: 14, weight: .medium)).buttonStyle(.plain)
                    }
                }
                .transition(.opacity)
            }
            HStack(spacing: 8) {
                Picker("Art", selection: $mode.animation(.snappy(duration: 0.28))) {
                    Text("Kommentar").tag(Mode.text)
                    Text("Umfrage").tag(Mode.poll)
                }
                .pickerStyle(.segmented)
                .frame(width: 196)
                Spacer(minLength: 0)
                Button {
                    busy = true
                    Task {
                        let answers = options.map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
                        let isPoll = mode == .poll
                        let body = isPoll ? question.trimmingCharacters(in: .whitespaces) : text.trimmingCharacters(in: .whitespacesAndNewlines)
                        if await send(body, isPoll ? (body, answers) : nil) {
                            text = ""; question = ""; options = ["", ""]; focused = false
                        }
                        busy = false
                    }
                } label: {
                    SendLabel()
                }
                .buttonStyle(.plain)
                .opacity(busy || !ready ? 0.4 : 1)
                .disabled(busy || !ready)
            }
        }
    }

    private var ready: Bool {
        if isOwn && name.trimmingCharacters(in: .whitespaces).count < 2 { return false }
        if mode == .poll {
            return question.trimmingCharacters(in: .whitespaces).count >= 2
                && options.filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }.count >= 2
        }
        return text.trimmingCharacters(in: .whitespacesAndNewlines).count >= 2
    }
}

/// The round black Senden of the site's comment boxes.
private struct SendLabel: View {
    var body: some View {
        Text("Senden").font(.system(size: 14, weight: .semibold))
            .padding(.horizontal, 16).frame(height: 36)
            .foregroundStyle(Color.tiBackground).background(Color.tiForeground, in: Capsule())
    }
}

/// The reply box under a comment: opens with the keyboard up.
private struct ReplyField: View {
    let isOwn: Bool
    @Binding var name: String
    let to: String
    let send: (String) async -> Bool
    @State private var text = ""
    @State private var busy = false
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .trailing, spacing: 8) {
            if isOwn && name.trimmingCharacters(in: .whitespaces).count < 2 {
                TextField("Dein Name", text: $name).textContentType(.nickname).siteField()
            }
            TextField("Antwort an \(to)", text: $text, axis: .vertical).lineLimit(1...6).focused($focused).siteField()
            Button {
                busy = true
                Task {
                    if await send(text.trimmingCharacters(in: .whitespacesAndNewlines)) { text = "" }
                    busy = false
                }
            } label: { SendLabel() }
            .buttonStyle(.plain)
            .opacity(busy || text.trimmingCharacters(in: .whitespacesAndNewlines).count < 2 ? 0.4 : 1)
            .disabled(busy || text.trimmingCharacters(in: .whitespacesAndNewlines).count < 2)
        }
        .padding(.top, 6)
        .onAppear { focused = true }
    }
}

private extension View {
    func field() -> some View { siteField() }
}
