import Foundation
import Observation

/// Where comments hang: a LigaInsider thread (an article's id, or "t…" for a club's lineup page; `page` is the
/// original's URL, sent as referer) or one of our own posts (D1, no login: a name and the phone's vote id).
enum CommentThread: Hashable {
    case liga(key: String, page: String?)
    case own(postId: Int)
}

/// A comment as both kinds of thread show it.
struct ThreadComment: Identifiable, Hashable, Decodable {
    var id: Int
    var user: String
    /// LigaInsider's date is missing now and then (the site sends ""): then the comment shows without a time.
    var date: Date?
    var text: String
    var score: Int
    /// This viewer upvoted it (LigaInsider: vote == 1).
    var voted: Bool
    var poll: ThreadPoll?
    var replies: [ThreadComment]
    /// Written here and still on its way: greyed, "Wird gesendet …", nothing to tap yet.
    var pending = false
    /// What the list knows a comment written here by, from the tap on Senden on: it stays the same row when the
    /// site's answer gives it its id.
    var draftKey: Int?

    var key: Int { draftKey ?? id }
    /// On the site (not a draft, not one LigaInsider gave no id for): it can be voted for and answered.
    var isSent: Bool { id > 0 && !pending }

    private enum CodingKeys: String, CodingKey { case id, user, date, text, score, voted, vote, poll, replies }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(Int.self, forKey: .id)
        user = try c.decode(String.self, forKey: .user)
        date = try? c.decode(Date.self, forKey: .date)
        text = try c.decode(String.self, forKey: .text)
        score = try c.decode(Int.self, forKey: .score)
        voted = try c.decodeIfPresent(Bool.self, forKey: .voted) ?? ((try c.decodeIfPresent(Int.self, forKey: .vote)) == 1)
        poll = try c.decodeIfPresent(ThreadPoll.self, forKey: .poll)
        replies = try c.decodeIfPresent([ThreadComment].self, forKey: .replies) ?? []
    }

    init(id: Int, user: String, date: Date?, text: String) {
        self.id = id; self.user = user; self.date = date; self.text = text
        score = 0; voted = false; replies = []
    }
}

/// A poll: LigaInsider's (votingId; `voted` without saying which) or ours (`mine`). Results show once voted.
struct ThreadPoll: Hashable, Decodable {
    var question: String
    var total: Int
    var options: [Option]
    var votingId: Int?
    var voted: Bool?
    var mine: Int?

    struct Option: Hashable, Decodable { var id: Int?; var label: String; var pct: Int }

    var hasVoted: Bool { voted == true || mine != nil }

    /// The poll right after this phone's vote: one more for that answer, percentages whole and adding up to 100.
    func with(vote option: Int) -> ThreadPoll {
        var counts = options.map { Double($0.pct) * Double(total) / 100 }.map { $0.rounded() }
        if let i = options.firstIndex(where: { $0.id == option }) { counts[i] += 1 }
        let sum = counts.reduce(0, +)
        var next = self
        next.total = total + 1
        next.voted = true
        next.mine = option
        if sum > 0 {
            // Largest remainder: floor every share, then give the missing points to the biggest leftovers.
            let exact = counts.map { $0 * 100 / sum }
            var pct = exact.map { Int($0.rounded(.down)) }
            let order = exact.indices.sorted { exact[$0] - Double(pct[$0]) > exact[$1] - Double(pct[$1]) }
            for i in order.prefix(100 - pct.reduce(0, +)) { pct[i] += 1 }
            for i in next.options.indices { next.options[i].pct = pct[i] }
        }
        return next
    }
}

private struct ThreadPage: Decodable {
    var total: Int
    var comments: [ThreadComment]
    var more: Cursor?
}

struct Cursor: Codable, Hashable { var offset: Int; var goffset: Int; var moffset: Int; var cursor: Int }

/// How long the fields may get: the site's maxlength (Comments.astro, OwnComments.astro, CommentComposer.astro),
/// counted as the browser and the server count (UTF-16 units).
struct CommentLimits: Equatable {
    var text: Int
    var question = 200
    var answer = 80
    var name = 30
    /// The site's servers take a poll's question from three characters on.
    static let questionMin = 3

    static let liga = CommentLimits(text: 2000)
    static let own = CommentLimits(text: 1000)
}

extension String {
    /// Cut to what an input with that maxlength holds, never through the middle of a character.
    func limited(to max: Int) -> String {
        guard utf16.count > max else { return self }
        var out = "", units = 0
        for character in self {
            units += character.utf16.count
            if units > max { break }
            out.append(character)
        }
        return out
    }
}

@Observable @MainActor
final class CommentsModel {
    let thread: CommentThread
    private(set) var comments: [ThreadComment] = []
    private(set) var total = 0
    private(set) var loaded = false
    /// The thread couldn't be loaded: the screen says so and offers to try again.
    private(set) var loadFailed = false
    /// LigaInsider didn't answer and the site sent its last copy ("x-stale").
    private(set) var stale = false
    /// Comments and polls with a vote on its way: taps on them wait.
    private var voting = Set<Int>()
    private(set) var loadingMore = false
    /// The last thing that went wrong, in the site's words (shown briefly).
    var message: String?
    private var more: Cursor?
    private let api: API
    /// LigaInsider says only that he voted in a poll, not for what: the phone remembers it (the site: localStorage).
    private let votes: UserDefaults
    /// The pause before the one quiet second try of a LigaInsider thread.
    private let retryAfter: Duration

    var hasMore: Bool { more != nil }
    var isOwn: Bool { if case .own = thread { true } else { false } }
    var limits: CommentLimits { isOwn ? .own : .liga }

    /// Comments and answers on the screen (not those still being sent).
    private var shown: Int { Self.count(comments) }
    private static func count(_ list: [ThreadComment]) -> Int {
        list.reduce(0) { $0 + ($1.pending ? 0 : 1) + count($1.replies) }
    }

    /// The button for the next batch says how many are left (Comments.astro showLoadMore).
    var moreLabel: String {
        let left = total - shown
        return left > 0 ? "Weitere Kommentare laden (\(left))" : "Weitere Kommentare laden"
    }

    /// The same thread on LigaInsider.
    var original: URL? {
        guard case .liga(_, let page) = thread, let page else { return nil }
        return URL(string: page)
    }

    /// The link to the original under the thread: when it couldn't be loaded, and when there are more comments
    /// than shown but no next batch to load (LigaInsider stops sending one).
    var originalLabel: String? {
        guard original != nil, loaded else { return nil }
        if loadFailed && comments.isEmpty { return "Alle Kommentare auf ligainsider.de ↗" }
        if !loadFailed, !comments.isEmpty, more == nil, total > shown { return "Alle \(total) Kommentare auf ligainsider.de ↗" }
        return nil
    }

    init(thread: CommentThread, api: API = .shared, votes: UserDefaults = .standard, retryAfter: Duration = .milliseconds(800)) {
        self.thread = thread
        self.api = api
        self.votes = votes
        self.retryAfter = retryAfter
    }

    private static let votesKey = "liPollVotes"
    private var remembered: [String: Int] { votes.dictionary(forKey: Self.votesKey) as? [String: Int] ?? [:] }

    /// His answers in LigaInsider polls, from what the phone remembers.
    private func withMine(_ list: [ThreadComment]) -> [ThreadComment] {
        let known = remembered
        guard !known.isEmpty else { return list }
        return list.map { c in
            var c = c
            if let id = c.poll?.votingId, let option = known[String(id)], c.poll?.mine == nil { c.poll?.mine = option }
            c.replies = withMine(c.replies)
            return c
        }
    }

    /// A load given up (the page went away) leaves the thread as not loaded yet: it loads when the page is back.
    func load() async {
        do {
            let (page, response) = try await firstPage()
            comments = withMine(page.comments)
            total = page.total
            more = page.more
            stale = response.value(forHTTPHeaderField: "x-stale") == "1"
            loadFailed = false
        } catch is CancellationError {
            return
        } catch {
            loadFailed = true
        }
        loaded = true
    }

    private func firstPage() async throws -> (ThreadPage, HTTPURLResponse) {
        do {
            return try await api.answer(base)
        } catch let error where !isOwn && !(error is CancellationError) {
            // One quiet second try: LigaInsider often answers the next request right away (Comments.astro load).
            try await Task.sleep(for: retryAfter)
            return try await api.answer(base)
        }
    }

    private var batch: Task<Void, Never>?

    /// One batch at a time: a second call while one loads waits for it (the jump to a conversation and the
    /// scrolling both ask). The batch itself belongs to no screen: it comes in even when the asker went away.
    func loadMore() async {
        if let batch { return await batch.value }
        guard more != nil, !isOwn else { return }
        let task = Task { await loadBatch() }
        batch = task
        await task.value
        batch = nil
    }

    private func loadBatch() async {
        guard let cursor = more else { return }
        loadingMore = true
        defer { loadingMore = false }
        do {
            let page: ThreadPage = try await api.get("\(base)more/", query: [
                .init(name: "offset", value: "\(cursor.offset)"), .init(name: "goffset", value: "\(cursor.goffset)"),
                .init(name: "moffset", value: "\(cursor.moffset)"), .init(name: "cursor", value: "\(cursor.cursor)"),
            ])
            // Batches can overlap by a comment; each shows once.
            let known = Set(comments.map(\.id))
            let fresh = page.comments.filter { !known.contains($0.id) }
            comments += withMine(fresh)
            // An empty batch or the same cursor again means the end.
            more = !fresh.isEmpty && page.more?.cursor != cursor.cursor ? page.more : nil
        } catch {
            failed(error, saying: "Weitere Kommentare gerade nicht erreichbar.")
        }
    }

    /// The conversation a link from "Deine Chats" points at, shown once: coming back to the page doesn't pull
    /// the reader down to it again.
    private var focusShown = false

    func takeFocus(_ id: Int) async -> Bool {
        guard !focusShown, await reveal(id) else { return false }
        focusShown = true
        return true
    }

    /// Loads batches until the conversation (a top-level comment) is there; false when it isn't after 12 more.
    func reveal(_ id: Int) async -> Bool {
        for _ in 0..<12 {
            if comments.contains(where: { $0.id == id }) { return true }
            guard hasMore else { return false }
            await loadMore()
        }
        return comments.contains { $0.id == id }
    }

    /// Up or back, shown at once; undone if the site says no.
    func toggleVote(_ id: Int) async {
        guard !voting.contains(id), let before = find(id), before.isSent else { return }
        voting.insert(id)
        defer { voting.remove(id) }
        update(id) { $0.voted.toggle(); $0.score += $0.voted ? 1 : -1 }
        do {
            switch thread {
            case .own(let postId):
                let answer: OwnVote = try await api.post("api/own-comments/\(postId)/vote/", json: VoteBody(comment: id, on: !before.voted))
                update(id) { $0.score = answer.score; $0.voted = answer.voted }
            case .liga:
                let _: LigaAnswer = try await api.post("api/li-comment/", json: LigaAction.vote(id, current: before.voted ? 1 : 0, thread: thread))
            }
        } catch {
            update(id) { $0.voted = before.voted; $0.score = before.score }
            failed(error)
        }
    }

    func votePoll(comment id: Int, option: Int) async {
        guard !voting.contains(id), let poll = find(id)?.poll, !poll.hasVoted else { return }
        voting.insert(id)
        defer { voting.remove(id) }
        do {
            switch thread {
            case .own(let postId):
                // A repeated vote (409) answers with the poll as it stands, the earlier choice ticked.
                let answer: PollAnswer = try await api.post("api/own-comments/\(postId)/poll-vote/", json: PollVoteBody(comment: id, option: option), alsoAccept: [409])
                if let fresh = answer.poll { update(id) { $0.poll = fresh } }
            case .liga:
                guard let votingId = poll.votingId else { return }
                let _: LigaAnswer = try await api.post("api/li-comment/", json: LigaAction.pollVote(votingId, option: option, thread: thread))
                var known = remembered
                known[String(votingId)] = option
                votes.set(known, forKey: Self.votesKey)
                // LigaInsider's answer has no result: worked out here like the site (commentUi.ts withVote).
                update(id) { $0.poll = $0.poll?.with(vote: option) }
            }
        } catch {
            failed(error)
        }
    }

    private var drafts = 0

    /// A comment, a reply (parent: a comment or, in LigaInsider threads, an answer) or a poll; own posts need a
    /// name, `author` is the LigaInsider name. It shows at once, greyed, where it belongs, and becomes the sent one
    /// when the site answers; on failure it goes away again (false: the caller puts the text back in its field).
    /// Pages loaded with "more" stay.
    @discardableResult
    func send(text: String, parent: Int? = nil, poll: (question: String, options: [String])? = nil, name: String? = nil, author: String? = nil) async -> Bool {
        drafts += 1
        let key = -drafts
        var draft = ThreadComment(id: key, user: isOwn ? name ?? "" : author ?? "Du", date: .now, text: poll?.question ?? text)
        draft.pending = true
        draft.draftKey = key
        if let poll {
            // LigaInsider's shows as results right away (its answers get their ids only with the thread).
            draft.poll = ThreadPoll(question: poll.question, total: 0, options: poll.options.map { .init(id: nil, label: $0, pct: 0) },
                                    votingId: nil, voted: isOwn ? nil : true, mine: nil)
        }
        // The conversation an answer belongs to (an answer can answer an answer), for "Deine Chats".
        let root = parent.flatMap { id in comments.first { $0.id == id || Self.find(id, in: $0.replies) != nil }?.id }
        place(draft, under: parent)
        do {
            switch thread {
            case .own(let postId):
                let body = OwnPost(name: name ?? "", text: text, parent: parent, poll: poll.map { .init(question: $0.question, options: $0.options) })
                let answer: OwnPostAnswer = try await api.post("api/own-comments/\(postId)/", json: body)
                if let saved = answer.comment {
                    settle(key, as: saved, under: parent)
                } else {
                    remove(key)
                    await load()
                }
            case .liga:
                let action: LigaAction = if let poll { .poll(poll.question, options: poll.options, thread: thread) }
                    else if let parent { .reply(parent, text: text, root: root, thread: thread) }
                    else { .comment(text, thread: thread) }
                let answer: LigaAnswer = try await api.post("api/li-comment/", json: action)
                var saved = draft
                saved.pending = false
                saved.id = answer.commentId ?? key
                settle(key, as: saved, under: parent)
                if let poll { await adoptPoll(key, question: poll.question) }
            }
            return true
        } catch {
            remove(key)
            failed(error)
            return false
        }
    }

    /// A poll just sent to LigaInsider can be voted in only with its voting id, which the thread has: its newest
    /// comments are asked for again and only the poll taken from them, so everything loaded stays.
    private func adoptPoll(_ key: Int, question: String) async {
        guard let page: ThreadPage = try? await api.get(base), let mine = comments.first(where: { $0.draftKey == key }) else { return }
        let known = Set(comments.map(\.id))
        guard var saved = page.comments.first(where: { $0.id == mine.id })
            ?? page.comments.first(where: { !known.contains($0.id) && $0.poll?.question == question }) else { return }
        saved.draftKey = key
        Self.change(&comments, { $0.draftKey == key }) { list, i in list[i] = saved }
    }

    private var base: String {
        switch thread {
        case .liga(let key, _): "api/comments/\(key)/"
        case .own(let postId): "api/own-comments/\(postId)/"
        }
    }

    /// Nothing is said about a request given up on purpose.
    private func failed(_ error: Error, saying fallback: String = "Das hat nicht geklappt. Versuch es gleich nochmal.") {
        if error is CancellationError { return }
        message = (error as? APIError)?.message ?? fallback
    }

    /// A new comment on top, an answer last under what it answers.
    private func place(_ comment: ThreadComment, under parent: Int?) {
        if let parent, Self.change(&comments, { $0.id == parent }, { list, i in list[i].replies.append(comment) }) { return }
        comments.insert(comment, at: 0)
    }

    /// The draft becomes the sent comment in place, now counted; if the thread was loaded anew meanwhile, it goes in.
    private func settle(_ key: Int, as saved: ThreadComment, under parent: Int?) {
        var saved = saved
        saved.draftKey = key
        total += 1
        if Self.change(&comments, { $0.draftKey == key }, { list, i in list[i] = saved }) { return }
        if find(saved.id) == nil { place(saved, under: parent) }
    }

    private func remove(_ key: Int) {
        Self.change(&comments, { $0.draftKey == key && $0.pending }) { list, i in list.remove(at: i) }
    }

    private func find(_ id: Int) -> ThreadComment? { Self.find(id, in: comments) }

    private static func find(_ id: Int, in list: [ThreadComment]) -> ThreadComment? {
        for c in list {
            if c.id == id { return c }
            if let r = find(id, in: c.replies) { return r }
        }
        return nil
    }

    private func update(_ id: Int, _ change: (inout ThreadComment) -> Void) {
        Self.change(&comments, { $0.id == id }) { list, i in change(&list[i]) }
    }

    /// The first comment that matches, at any depth, changed in its list; false when there is none.
    @discardableResult
    private static func change(_ list: inout [ThreadComment], _ match: (ThreadComment) -> Bool, _ body: (inout [ThreadComment], Int) -> Void) -> Bool {
        if let i = list.firstIndex(where: match) { body(&list, i); return true }
        for i in list.indices where change(&list[i].replies, match, body) { return true }
        return false
    }
}

// The requests, as the site's endpoints read them (src/pages/api/li-comment.ts, own-comments/…).

private struct VoteBody: Encodable { let comment: Int; let on: Bool }
private struct OwnVote: Decodable { let score: Int; let voted: Bool }
private struct PollVoteBody: Encodable { let comment: Int; let option: Int }
private struct PollAnswer: Decodable { let poll: ThreadPoll? }
private struct OwnPost: Encodable {
    let name: String; let text: String; let parent: Int?; let poll: NewPoll?
    struct NewPoll: Encodable { let question: String; let options: [String] }
}
private struct OwnPostAnswer: Decodable { let ok: Bool?; let comment: ThreadComment? }
/// LigaInsider's answer, passed through by li-comment: the new comment's id comes as text ("commentID": "123").
private struct LigaAnswer: Decodable {
    let ok: Bool?
    let commentId: Int?

    private enum CodingKeys: String, CodingKey { case ok, commentId }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        ok = try c.decodeIfPresent(Bool.self, forKey: .ok)
        commentId = (try? c.decodeIfPresent(Int.self, forKey: .commentId))
            ?? (try? c.decodeIfPresent(String.self, forKey: .commentId)).flatMap { $0.flatMap(Int.init) }
    }
}

private struct LigaAction: Encodable {
    var thread: String
    var page: String?
    var kind: String
    var body: String?
    var commentId: Int?
    /// With an answer: the conversation's top comment (li-comment.ts, for "Deine Chats").
    var root: Int?
    var currentVote: Int?
    var votingId: Int?
    var optionId: Int?
    var question: String?
    var options: [String]?

    private init(_ kind: String, _ thread: CommentThread) {
        guard case .liga(let key, let page) = thread else { preconditionFailure("not a LigaInsider thread") }
        self.kind = kind
        self.thread = key
        self.page = page
    }

    static func comment(_ text: String, thread: CommentThread) -> LigaAction {
        var a = LigaAction("comment", thread); a.body = text; return a
    }
    static func reply(_ id: Int, text: String, root: Int?, thread: CommentThread) -> LigaAction {
        var a = LigaAction("reply", thread); a.commentId = id; a.body = text; a.root = root; return a
    }
    static func vote(_ id: Int, current: Int, thread: CommentThread) -> LigaAction {
        var a = LigaAction("vote", thread); a.commentId = id; a.currentVote = current; return a
    }
    static func pollVote(_ votingId: Int, option: Int, thread: CommentThread) -> LigaAction {
        var a = LigaAction("pollvote", thread); a.votingId = votingId; a.optionId = option; return a
    }
    static func poll(_ question: String, options: [String], thread: CommentThread) -> LigaAction {
        var a = LigaAction("poll", thread); a.question = question; a.options = options; return a
    }
}
