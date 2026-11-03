import Foundation
import Observation

/// Mein Team's data: the last one per league kept on the phone (shown at once), then loaded fresh;
/// while a match runs, the live points every 30 seconds (as the page's script does).
@Observable @MainActor
final class MyTeamModel {
    private(set) var team: AppTeam?
    private(set) var loading = false
    private(set) var message: String?
    /// The league to show (nil: the one Kickbase or the last choice gives).
    var leagueId: String?

    private let api: API
    private let directory: URL

    init(api: API = .shared, directory: URL = .cachesDirectory.appending(path: "my-team")) {
        self.api = api
        self.directory = directory
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    var showsLoginPrompt: Bool { team?.signedOut != nil }

    private func file(_ league: String?) -> URL { directory.appending(path: "\(league ?? "default").json") }

    func loadCached() {
        guard team == nil, let data = try? Data(contentsOf: file(leagueId)) else { return }
        team = try? JSONDecoder.site.decode(AppTeam.self, from: data)
    }

    func load() async {
        loading = true
        defer { loading = false }
        do {
            let fresh: AppTeam = try await api.get("api/app/my-team/", query: leagueId.map { [URLQueryItem(name: "league", value: $0)] } ?? [])
            message = fresh.error
            // Kickbase not reachable: the team on screen stays, with the message above it.
            if fresh.error != nil, fresh.signedOut == nil, team?.players.isEmpty == false { return }
            team = fresh
            if fresh.signedOut == nil, fresh.error == nil, let data = try? JSONEncoder.site.encode(fresh) {
                try? data.write(to: file(leagueId), options: .atomic)
                if leagueId == nil { try? data.write(to: file(fresh.leagueId), options: .atomic) }
            }
        } catch {
            message = (error as? APIError)?.message
        }
    }

    func choose(league: String) async {
        leagueId = league
        if let data = try? Data(contentsOf: file(league)), let cached = try? JSONDecoder.site.decode(AppTeam.self, from: data) { team = cached }
        await load()
    }

    /// The live points while a match runs (GET /api/kickbase/live/?league=…).
    func pollLive() async {
        while !Task.isCancelled {
            try? await Task.sleep(for: .seconds(30))
            guard let team, team.running, let league = team.leagueId else { continue }
            guard let live: LiveAnswer = try? await api.get("api/kickbase/live/", query: [URLQueryItem(name: "league", value: league)]) else { continue }
            var next = team
            for (id, l) in live.players { next.players[id]?.live = l }
            if let points = live.points { next.points = points }
            next.started = next.lines.flatMap { $0 }.contains { (next.players[$0]?.live?.state ?? 0) > 0 }
            self.team = next
        }
    }

    private struct LiveAnswer: Decodable { var points: Int?; var players: [String: AppTeam.Live] }
}

extension JSONEncoder {
    /// Dates back as ISO 8601, as the site writes them (JSONDecoder.site reads them).
    static let site: JSONEncoder = {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .iso8601
        return e
    }()
}
