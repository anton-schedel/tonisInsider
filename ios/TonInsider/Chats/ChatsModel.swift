import Foundation
import Observation

/// One row of "Deine Chats" as the site sends it (src/lib/chatsApi.ts ChatView): the texts come worked out, so the
/// app and the website say the same.
struct ChatView: Decodable, Identifiable, Hashable {
    struct Place: Decodable, Hashable {
        struct Club: Decodable, Hashable { var name: String; var slug: String; var crest: String? }
        var title: String
        var href: String
        var club: Club?
        var own: Bool?
    }
    struct News: Decodable, Hashable { var answers: Int; var votes: Int; var poll: Int }
    struct Lines: Decodable, Hashable { var mine: String; var status: String }
    /// ok; gone (comment or article no longer there); over (the lineup page moved on to the next match).
    enum Status: String, Decodable { case ok, gone, over }

    var id: Int
    var place: Place
    var link: String
    var started: Bool
    var kind: String
    var activityAt: Date
    var status: Status
    var news: News?
    var lines: Lines
    var checked: Bool

    var hasNews: Bool { news != nil && status == .ok }
}

/// Where a chat leads: the article or the club's lineup page, at the conversation (the link's "#c<id>").
enum ChatTarget: Equatable {
    case article(id: Int, comment: Int)
    case club(slug: String, comment: Int)

    init?(link: String) {
        let parts = link.split(separator: "#c", maxSplits: 1)
        guard parts.count == 2, let comment = Int(parts[1]) else { return nil }
        let path = parts[0].split(separator: "/")
        guard path.count == 2 else { return nil }
        switch path[0] {
        case "artikel": guard let id = Int(path[1]) else { return nil }; self = .article(id: id, comment: comment)
        case "vereine": self = .club(slug: String(path[1]), comment: comment)
        default: return nil
        }
    }

    /// The route into the article; `chat` is marked seen when it opens.
    func articleRoute(chat: Int) -> ArticleRoute? {
        if case .article(let id, let comment) = self { ArticleRoute(id: id, comment: comment, chat: chat) } else { nil }
    }

    func clubRoute(chat: Int) -> ClubRoute? {
        if case .club(let slug, let comment) = self { ClubRoute(slug: slug, comment: comment, chat: chat) } else { nil }
    }
}

/// "Deine Chats": the conversations you wrote in (kept on the site under your LigaInsider login, so the website and
/// the phone show the same), each read fresh, and the number of those with news for the bubble on News.
@Observable @MainActor
final class ChatsModel {
    private(set) var chats: [ChatView] = []
    private(set) var signedIn = false
    private(set) var loaded = false
    private(set) var loadFailed = false
    /// Chats with news since you last looked (the bubble's red number).
    var badge: Int { chats.filter(\.hasNews).count }
    /// The list is on screen: rows keep their place (new ones go to the end), the order follows the next time.
    var isOpen = false

    /// Each look reads every chat's thread: at most this often.
    static let checkEvery: TimeInterval = 180
    /// A conversation further down LigaInsider's thread than this many batches isn't looked for (chatsApi.ts).
    private static let maxBatches = 12

    private let api: API
    private let isSignedIn: () -> Bool
    private var lastCheck: Date?
    private var checking = false

    init(api: API = .shared, signedIn: @escaping () -> Bool) {
        self.api = api
        self.isSignedIn = signedIn
    }

    /// The stored list at once (one request); `refreshAll` reads each chat afterwards.
    func load() async {
        guard isSignedIn() else { clear(); loaded = true; return }
        do {
            let answer: ChatsAnswer = try await api.get("api/chats/")
            signedIn = answer.signedIn
            if isOpen, !chats.isEmpty {
                let fresh = Dictionary(answer.chats.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
                let kept = Set(chats.map(\.id))
                chats = chats.compactMap { fresh[$0.id] } + answer.chats.filter { !kept.contains($0.id) }
            } else {
                chats = answer.chats
            }
            loadFailed = false
        } catch {
            loadFailed = chats.isEmpty
        }
        loaded = true
    }

    /// Every chat read fresh, three at a time; rows change in place, the order stays while the list is open.
    func refreshAll() async {
        let ids = chats.map(\.id)
        await withTaskGroup(of: ChatView?.self) { group in
            var next = ids.makeIterator()
            for _ in 0..<3 { if let id = next.next() { group.addTask { await self.refresh(id) } } }
            while let result = await group.next() {
                if let fresh = result, let i = chats.firstIndex(where: { $0.id == fresh.id }) { chats[i] = fresh }
                if let id = next.next() { group.addTask { await self.refresh(id) } }
            }
        }
    }

    /// One chat read fresh, following LigaInsider's batches; nil when it can't be read right now.
    func refresh(_ id: Int) async -> ChatView? {
        var cursor: Cursor?
        for batch in 0..<Self.maxBatches {
            // n: which batch this is, so the site keeps what it knows on the last one instead of another cursor.
            let query: [URLQueryItem] = cursor.map { c in [
                .init(name: "offset", value: "\(c.offset)"), .init(name: "goffset", value: "\(c.goffset)"),
                .init(name: "moffset", value: "\(c.moffset)"), .init(name: "cursor", value: "\(c.cursor)"),
                .init(name: "n", value: "\(batch)"),
            ] } ?? []
            guard let answer: RefreshAnswer = try? await api.get("api/chats/\(id)/", query: query) else { return nil }
            if let chat = answer.chat { return chat }
            guard let more = answer.next else { return nil }
            cursor = more
        }
        return nil
    }

    /// The bubble's look for news: when the app comes forward and every few minutes, not more often.
    func check(now: Date = .now, force: Bool = false) async {
        guard isSignedIn() else { clear(); return }
        guard !checking, force || lastCheck.map({ now.timeIntervalSince($0) >= Self.checkEvery }) ?? true else { return }
        checking = true
        defer { checking = false }
        lastCheck = now
        await load()
        await refreshAll()
    }

    /// You opened it: seen here and on the website.
    func open(_ id: Int) async {
        if let i = chats.firstIndex(where: { $0.id == id }) { chats[i].news = nil }
        let _: Ok? = try? await api.post("api/chats/\(id)/seen/", json: Empty())
    }

    /// Signed out of LigaInsider: nothing of the last account stays.
    func clear() {
        chats = []
        signedIn = false
        lastCheck = nil
    }
}

private struct ChatsAnswer: Decodable { let signedIn: Bool; let chats: [ChatView] }
private struct RefreshAnswer: Decodable { let chat: ChatView?; let next: Cursor? }
private struct Ok: Decodable { let ok: Bool? }
private struct Empty: Encodable {}
