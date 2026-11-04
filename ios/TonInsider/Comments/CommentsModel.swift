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
    var date: Date
    var text: String
    var score: Int
    /// This viewer upvoted it (LigaInsider: vote == 1).
    var voted: Bool
    var poll: ThreadPoll?
    var replies: [ThreadComment]

    private enum CodingKeys: String, CodingKey { case id, user, date, text, score, voted, vote, poll, replies }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(Int.self, forKey: .id)
        user = try c.decode(String.self, forKey: .user)
        date = try c.decode(Date.self, forKey: .date)
        text = try c.decode(String.self, forKey: .text)
        score = try c.decode(Int.self, forKey: .score)
        voted = try c.decodeIfPresent(Bool.self, forKey: .voted) ?? ((try c.decodeIfPresent(Int.self, forKey: .vote)) == 1)
        poll = try c.decodeIfPresent(ThreadPoll.self, forKey: .poll)
        replies = try c.decodeIfPresent([ThreadComment].self, forKey: .replies) ?? []
    }

    init(id: Int, user: String, date: Date, text: String) {
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

@Observable @MainActor
final class CommentsModel {
    let thread: CommentThread
    private(set) var comments: [ThreadComment] = []
    private(set) var total = 0
    private(set) var loaded = false
    /// The thread couldn't be loaded (offline): the screen says so and offers to try again.
    private(set) var loadFailed = false
    /// Comments and polls with a vote on its way: taps on them wait.
    private var voting = Set<Int>()
    private(set) var loadingMore = false
    /// The last thing that went wrong, in the site's words (shown briefly).
    var message: String?
    private var more: Cursor?
    private let api: API
    /// LigaInsider says only that he voted in a poll, not for what: the phone remembers it (the site: localStorage).
    private let votes: UserDefaults

    var hasMore: Bool { more != nil }

    init(thread: CommentThread, api: API = .shared, votes: UserDefaults = .standard) {
        self.thread = thread
        self.api = api
        self.votes = votes
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

    func load() async {
        do {
            let page: ThreadPage = try await api.get(base)
            comments = withMine(page.comments)
            total = page.total
            more = page.more
            loadFailed = false
        } catch {
            loadFailed = true
        }
        loaded = true
    }

    func loadMore() async {
        guard let cursor = more, case .liga = thread, !loadingMore else { return }
        loadingMore = true
        defer { loadingMore = false }
        do {
            let page: ThreadPage = try await api.get("\(base)more/", query: [
                .init(name: "offset", value: "\(cursor.offset)"), .init(name: "goffset", value: "\(cursor.goffset)"),
                .init(name: "moffset", value: "\(cursor.moffset)"), .init(name: "cursor", value: "\(cursor.cursor)"),
            ])
            let known = Set(comments.map(\.id))
            comments += withMine(page.comments.filter { !known.contains($0.id) })
            more = page.more
        } catch {
            message = (error as? APIError)?.message ?? "Das hat nicht geklappt. Versuch es gleich nochmal."
        }
    }

    /// Up or back, shown at once; undone if the site says no.
    func toggleVote(_ id: Int) async {
        guard !voting.contains(id), let before = find(id) else { return }
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
            update(id) { $0 = before }
            message = (error as? APIError)?.message ?? "Das hat nicht geklappt. Versuch es gleich nochmal."
        }
    }

    func votePoll(comment id: Int, option: Int) async {
        guard !voting.contains(id), let poll = find(id)?.poll, !poll.hasVoted else { return }
        voting.insert(id)
        defer { voting.remove(id) }
        do {
            switch thread {
            case .own(let postId):
                let answer: PollAnswer = try await api.post("api/own-comments/\(postId)/poll-vote/", json: PollVoteBody(comment: id, option: option))
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
            message = (error as? APIError)?.message ?? "Das hat nicht geklappt. Versuch es gleich nochmal."
        }
    }

    /// A comment, a reply (parent) or a poll; own posts need a name, `author` is the LigaInsider name. True when
    /// it went through. The new comment goes in where it belongs, so pages loaded with "more" stay (only a new
    /// LigaInsider poll needs the thread again, for its voting id).
    @discardableResult
    func send(text: String, parent: Int? = nil, poll: (question: String, options: [String])? = nil, name: String? = nil, author: String? = nil) async -> Bool {
        do {
            switch thread {
            case .own(let postId):
                let body = OwnPost(name: name ?? "", text: text, parent: parent, poll: poll.map { .init(question: $0.question, options: $0.options) })
                let answer: OwnPostAnswer = try await api.post("api/own-comments/\(postId)/", json: body)
                if let saved = answer.comment { insert(saved, under: parent) } else { await load() }
            case .liga:
                let action: LigaAction = if let poll { .poll(poll.question, options: poll.options, thread: thread) }
                    else if let parent { .reply(parent, text: text, thread: thread) }
                    else { .comment(text, thread: thread) }
                let answer: LigaAnswer = try await api.post("api/li-comment/", json: action)
                if poll == nil, let id = answer.commentId {
                    insert(ThreadComment(id: id, user: author ?? "Du", date: .now, text: text), under: parent)
                } else {
                    await load()
                }
            }
            return true
        } catch {
            message = (error as? APIError)?.message ?? "Das hat nicht geklappt. Versuch es gleich nochmal."
            return false
        }
    }

    private var base: String {
        switch thread {
        case .liga(let key, _): "api/comments/\(key)/"
        case .own(let postId): "api/own-comments/\(postId)/"
        }
    }

    private func insert(_ comment: ThreadComment, under parent: Int?) {
        total += 1
        if let parent, let i = comments.firstIndex(where: { $0.id == parent }) {
            comments[i].replies.append(comment)
        } else {
            comments.insert(comment, at: 0)
        }
    }

    private func find(_ id: Int) -> ThreadComment? {
        for c in comments {
            if c.id == id { return c }
            if let r = c.replies.first(where: { $0.id == id }) { return r }
        }
        return nil
    }

    private func update(_ id: Int, _ change: (inout ThreadComment) -> Void) {
        for i in comments.indices {
            if comments[i].id == id { change(&comments[i]); return }
            if let j = comments[i].replies.firstIndex(where: { $0.id == id }) { change(&comments[i].replies[j]); return }
        }
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
    static func reply(_ id: Int, text: String, thread: CommentThread) -> LigaAction {
        var a = LigaAction("reply", thread); a.commentId = id; a.body = text; return a
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
