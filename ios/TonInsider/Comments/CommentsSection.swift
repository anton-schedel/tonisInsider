import SwiftUI

/// The comments under an article or a club's lineup (Comments.astro / OwnComments.astro): newest threads first,
/// upvotes, replies, polls, and the box to write. LigaInsider threads need a LigaInsider login to write; our own
/// posts take a name.
struct CommentsSection: View {
    @State private var model: CommentsModel
    @Environment(Account.self) private var account
    @Environment(Tabs.self) private var tabs
    @Environment(\.openURL) private var openURL
    @AppStorage("ownName") private var ownName = ""

    /// The conversation a link from "Deine Chats" points at, and how the page scrolls there.
    private let focus: Int?
    private let onFocus: (Int) -> Void
    @State private var highlighted: Int?
    /// LigaInsider takes its time: said after four seconds, instead of leaving only the spinner.
    @State private var slow = false
    /// The button for the next batch is on the screen: a short batch that leaves it there asks for the next one.
    @State private var atEnd = false

    init(thread: CommentThread, focus: Int? = nil, onFocus: @escaping (Int) -> Void = { _ in }) {
        _model = State(initialValue: CommentsModel(thread: thread))
        self.focus = focus
        self.onFocus = onFocus
    }

    private var isOwn: Bool { model.isOwn }
    private var canWrite: Bool { isOwn || account.ligaInsider }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline) {
                Text("Kommentare").font(.system(size: 20, weight: .bold)).tracking(-0.4)
                if model.total > 0 { Text("\(model.total)").foregroundStyle(Color.tiMuted).monospacedDigit() }
            }
            .padding(.bottom, 12)

            if canWrite {
                Composer(isOwn: isOwn, limits: model.limits, name: $ownName) { text, poll in
                    await model.send(text: text, poll: poll, name: ownName, author: account.ligaInsiderName)
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

            if let message = model.message {
                // Right where he wrote or tapped, not under the last comment.
                Text(message).font(.system(size: 14, weight: .medium)).foregroundStyle(Color.tiRed)
                    .padding(.bottom, 8)
                    .transition(.opacity)
                    .task(id: message) { try? await Task.sleep(for: .seconds(4)); withAnimation { model.message = nil } }
            }
            if model.stale {
                Text("LigaInsider antwortet gerade nicht. Das ist der zuletzt geladene Stand.")
                    .font(.system(size: 12)).foregroundStyle(Color.tiMuted).padding(.bottom, 12)
            }
            if !model.loaded {
                VStack(spacing: 12) {
                    ProgressView()
                    if slow && !isOwn {
                        Text("LigaInsider antwortet gerade langsam …").font(.system(size: 12)).foregroundStyle(Color.tiMuted)
                            .transition(.opacity)
                    }
                }
                .frame(maxWidth: .infinity).padding(.vertical, 24)
                .task {
                    try? await Task.sleep(for: .seconds(4))
                    if !Task.isCancelled { withAnimation { slow = true } }
                }
            } else if model.loadFailed && model.comments.isEmpty {
                VStack(spacing: 10) {
                    Text(isOwn ? "Kommentare konnten nicht geladen werden." : "Kommentare gerade nicht erreichbar.")
                        .font(.system(size: 15)).foregroundStyle(Color.tiMuted)
                    Button("Nochmal versuchen") { Task { await model.load() } }.buttonStyle(.quiet).frame(width: 200)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 16)
            } else if model.comments.isEmpty {
                Text(isOwn ? "Noch keine Kommentare. Schreib den ersten!" : "Noch keine Kommentare.")
                    .foregroundStyle(Color.tiMuted).padding(.vertical, 16)
            }
            LazyVStack(alignment: .leading, spacing: 0) {
                ForEach(Array(model.comments.enumerated()), id: \.element.key) { index, comment in
                    if index > 0 { Divider().overlay(Color.tiHairline) }
                    CommentTree(comment: comment, model: model, reply: false, canWrite: canWrite, name: $ownName,
                                author: account.ligaInsiderName) { tabs.selected = .settings }
                        .padding(.vertical, 14)
                        // Led here from "Deine Chats": our green for a moment, then it fades (the site's .comment-target).
                        .background {
                            RoundedRectangle(cornerRadius: 14, style: .continuous)
                                .fill(Color.tiBrand.opacity(highlighted == comment.id ? 0.13 : 0))
                                .padding(.horizontal, -8)
                        }
                        .id(comment.key)
                        // Reading toward the end brings the next batch by itself, before the button is reached.
                        .onAppear { if index >= model.comments.count - 3 { Task { await model.loadMore() } } }
                }
                if model.hasMore {
                    Button {
                        Task { await model.loadMore() }
                    } label: {
                        Text(model.moreLabel)
                            .font(.system(size: 15, weight: .semibold)).monospacedDigit()
                            .frame(maxWidth: .infinity).padding(.vertical, 12)
                            .background(Color.tiSurface, in: RoundedRectangle(cornerRadius: 12))
                            .opacity(model.loadingMore ? 0.5 : 1)
                    }
                    .buttonStyle(.plain)
                    .padding(.top, 12)
                    .onAppear { atEnd = true; Task { await model.loadMore() } }
                    .onDisappear { atEnd = false }
                    .onChange(of: model.comments.count) { if atEnd { Task { await model.loadMore() } } }
                }
            }
            if let label = model.originalLabel, let url = model.original {
                Button(label) { openURL(url) }
                    .font(.system(size: 14, weight: .medium)).foregroundStyle(Color.tiForeground).buttonStyle(.plain)
                    .frame(maxWidth: .infinity, alignment: model.loadFailed ? .center : .leading)
                    .padding(.vertical, 12).contentShape(Rectangle())
            }
        }
        .padding(.top, 32)
        // Once: coming back from another tab keeps the pages loaded with "more" and the place he was at. A load
        // given up when the page went away starts again here.
        .task {
            if !model.loaded { await model.load() }
            guard let focus, await model.takeFocus(focus) else { return }
            highlighted = focus
            // Once the comments just loaded are laid out, or the scroll has nothing to go to.
            try? await Task.sleep(for: .milliseconds(250))
            onFocus(focus)
            try? await Task.sleep(for: .seconds(1.4))
            withAnimation(.easeOut(duration: 1.4)) { highlighted = nil }
        }
    }
}

/// A comment with its answers under it, each level behind a hairline (commentUi.ts renderComment): LigaInsider's
/// answers can have answers of their own.
private struct CommentTree: View {
    let comment: ThreadComment
    let model: CommentsModel
    let reply: Bool
    let canWrite: Bool
    @Binding var name: String
    var author: String?
    let login: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            CommentRow(comment: comment, model: model, reply: reply, canWrite: canWrite, name: $name, author: author, login: login)
                // Still being sent: greyed; once sent it fades to full (.comment.is-pending in global.css).
                .opacity(comment.pending ? 0.55 : 1)
                .animation(.easeOut(duration: 0.2), value: comment.pending)
            if !comment.replies.isEmpty {
                VStack(alignment: .leading, spacing: 12) {
                    ForEach(comment.replies, id: \.key) {
                        CommentTree(comment: $0, model: model, reply: true, canWrite: canWrite, name: $name, author: author, login: login)
                    }
                }
                .padding(.leading, 12)
                .overlay(alignment: .leading) { Rectangle().fill(Color.tiHairline).frame(width: 2) }
                .padding(.leading, 15)
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
    /// His LigaInsider name, shown on a reply until the thread loads again.
    var author: String?
    /// To the logins: what a tap on ▲ or a poll's answer does without a LigaInsider login.
    let login: () -> Void
    @State private var replying = false
    /// What he is writing as an answer: kept while it is sent, so a failure puts it back in the field.
    @State private var draft = ""

    /// LigaInsider: an answer can be answered too; our own posts have one level (OwnComments.astro canReply).
    private var canReply: Bool { canWrite && comment.isSent && (!reply || !model.isOwn) }

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 10) {
                    Text(initials(comment.user).isEmpty ? "?" : initials(comment.user))
                        .font(.system(size: reply ? 10 : 11, weight: .semibold)).foregroundStyle(Color.tiMuted)
                        .frame(width: reply ? 28 : 32, height: reply ? 28 : 32)
                        .background(Color.tiSurface, in: Circle())
                    Text(comment.user).font(.system(size: 14, weight: .semibold)).lineLimit(1)
                    // LigaInsider's date is missing now and then: then no time.
                    if let stamp = comment.pending ? "Wird gesendet …" : comment.date.map({ Berlin.ago($0) }) {
                        Text(stamp).font(.system(size: 12)).foregroundStyle(Color.tiMuted).fixedSize()
                    }
                }
                // A poll's question can be its text too: shown once, in the poll.
                if !comment.text.isEmpty && comment.text != comment.poll?.question {
                    Text(comment.text).font(.system(size: 15)).lineSpacing(3).textSelection(.enabled)
                }
                if let poll = comment.poll {
                    PollView(poll: poll, canVote: canWrite && comment.isSent, login: canWrite || !comment.isSent ? nil : login) { option in
                        Task { await model.votePoll(comment: comment.id, option: option) }
                    }
                    .padding(.top, 4)
                }
                if canReply {
                    Button(replying ? "Abbrechen" : "Antworten") { withAnimation(.snappy(duration: 0.25)) { replying.toggle() } }
                        .font(.system(size: 12, weight: .medium)).foregroundStyle(Color.tiMuted).buttonStyle(.plain)
                        .padding(.vertical, 6).contentShape(Rectangle())
                }
                if replying {
                    ReplyField(isOwn: model.isOwn, limits: model.limits, name: $name, to: comment.user, text: $draft) { text in
                        // The answer shows at once under its comment; the box closes and comes back on failure.
                        withAnimation(.snappy(duration: 0.25)) { replying = false }
                        Task {
                            if await model.send(text: text, parent: comment.id, name: name, author: author) {
                                draft = ""
                            } else {
                                withAnimation(.snappy(duration: 0.25)) { replying = true }
                            }
                        }
                    }
                    .transition(.opacity)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if comment.isSent {
                // The count always shows; without a LigaInsider login the ▲ leads to the login (Comments.astro voteControl).
                VoteButton(voted: comment.voted, score: comment.score, needsLogin: !canWrite) {
                    if canWrite { Task { await model.toggleVote(comment.id) } } else { login() }
                }
            }
        }
    }
}

/// ▲ with the count, a finger-sized grey tile; filled once this phone voted (.vote-btn in global.css).
private struct VoteButton: View {
    let voted: Bool
    let score: Int
    var needsLogin = false
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
        .buttonStyle(.press)
        .accessibilityLabel(needsLogin ? "Zum Hochvoten anmelden" : voted ? "Deine Stimme" : "Hochvoten")
        .sensoryFeedback(.impact(weight: .light), trigger: voted)
    }
}

/// A poll as the site shows it (commentUi.ts renderPoll): the results always — a bar per answer, the leading one a
/// little darker, the percent on the right — and, until this phone voted, each answer a button. Its own answer gets ✓.
private struct PollView: View {
    let poll: ThreadPoll
    var canVote = true
    /// Voting needs a login: the answers lead there.
    var login: (() -> Void)?
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
                    Button { vote(id) } label: { row.contentShape(Rectangle()) }.buttonStyle(.pressRow)
                } else if !poll.hasVoted, let login {
                    Button(action: login) { row.contentShape(Rectangle()) }.buttonStyle(.pressRow)
                        .accessibilityHint("Zum Abstimmen anmelden")
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
    let limits: CommentLimits
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
            if isOwn { TextField("Dein Name", text: $name).textContentType(.nickname).siteField().limit($name, to: limits.name) }
            if mode == .text {
                TextField("Was sagst du dazu?", text: $text, axis: .vertical)
                    .lineLimit(3...8).focused($focused).siteField().limit($text, to: limits.text)
                    .transition(.opacity)
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    TextField("Frage der Umfrage…", text: $question).siteField().limit($question, to: limits.question)
                    ForEach(options.indices, id: \.self) { i in
                        TextField("Antwort…", text: $options[i]).siteField().limit($options[i], to: limits.answer)
                    }
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
                Button(action: submit) { SendLabel() }
                    .buttonStyle(.plain)
                    .opacity(busy || !ready ? 0.4 : 1)
                    .disabled(busy || !ready)
            }
        }
    }

    /// Shown at once (greyed, in the list) and the box emptied; a failure puts back what was typed
    /// (Comments.astro: composer.clear, composer.restore).
    private func submit() {
        let isPoll = mode == .poll
        let typed = (text: text, question: question, options: options)
        let answers = options.map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        let body = isPoll ? question.trimmingCharacters(in: .whitespaces) : text.trimmingCharacters(in: .whitespacesAndNewlines)
        // The other mode's fields keep what's in them.
        if isPoll { question = ""; options = ["", ""] } else { text = "" }
        focused = false
        busy = true
        Task {
            if !(await send(body, isPoll ? (body, answers) : nil)) {
                // Not over something he started typing meanwhile.
                if isPoll {
                    if question.isEmpty && options.allSatisfy(\.isEmpty) { question = typed.question; options = typed.options }
                } else if text.isEmpty {
                    text = typed.text
                }
            }
            busy = false
        }
    }

    private var ready: Bool {
        if isOwn && name.trimmingCharacters(in: .whitespaces).count < 2 { return false }
        if mode == .poll {
            return question.trimmingCharacters(in: .whitespaces).count >= CommentLimits.questionMin
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

/// The reply box under a comment: opens with the keyboard up. The text lives in the comment's row, so it is
/// still there when a failed send brings the box back.
private struct ReplyField: View {
    let isOwn: Bool
    let limits: CommentLimits
    @Binding var name: String
    let to: String
    @Binding var text: String
    let send: (String) -> Void
    /// Decided once: the name field mustn't vanish while he types it.
    @State private var needsName = false
    @FocusState private var focused: Bool

    private var ready: Bool {
        text.trimmingCharacters(in: .whitespacesAndNewlines).count >= 2 && (!isOwn || name.trimmingCharacters(in: .whitespaces).count >= 2)
    }

    var body: some View {
        VStack(alignment: .trailing, spacing: 8) {
            if needsName {
                TextField("Dein Name", text: $name).textContentType(.nickname).siteField().limit($name, to: limits.name)
            }
            TextField("Antwort an \(to)", text: $text, axis: .vertical).lineLimit(1...6).focused($focused).siteField()
                .limit($text, to: limits.text)
            Button { send(text.trimmingCharacters(in: .whitespacesAndNewlines)) } label: { SendLabel() }
                .buttonStyle(.plain)
                .opacity(ready ? 1 : 0.4)
                .disabled(!ready)
        }
        .padding(.top, 6)
        .onAppear {
            needsName = isOwn && name.trimmingCharacters(in: .whitespaces).count < 2
            focused = true
        }
    }
}

private extension View {
    /// The site's maxlength: what's typed or pasted beyond it is cut.
    func limit(_ text: Binding<String>, to max: Int) -> some View {
        onChange(of: text.wrappedValue) { _, typed in
            if typed.utf16.count > max { text.wrappedValue = typed.limited(to: max) }
        }
    }
}
