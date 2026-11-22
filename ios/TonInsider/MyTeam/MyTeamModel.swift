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
    private(set) var leagueId: String?

    private let api: API
    private let directory: URL
    /// Only the newest load may show its answer (a late one for the league before must not).
    private var request = 0
    /// The Kickbase session ran out. The site says so once ("expired") and clears the session in the same answer,
    /// so every answer after it only says "none": the prompt keeps saying what happened until the next login.
    private var expired = false

    /// Where the last team per league is kept.
    nonisolated static let cacheDirectory = URL.cachesDirectory.appending(path: "my-team")

    init(api: API = .shared, directory: URL = MyTeamModel.cacheDirectory) {
        self.api = api
        self.directory = directory
    }

    /// The stored teams go (Account calls this at every Kickbase login and logout, whether Mein Team is open or not).
    nonisolated static func forget(_ directory: URL) {
        try? FileManager.default.removeItem(at: directory)
    }

    var showsLoginPrompt: Bool { team?.signedOut != nil }

    private func file(_ league: String?) -> URL { directory.appending(path: "\(league ?? "default").json") }

    func loadCached() {
        guard team == nil, let data = try? Data(contentsOf: file(leagueId)) else { return }
        team = try? JSONDecoder.site.decode(AppTeam.self, from: data)
    }

    func load() async {
        request += 1
        let mine = request, league = leagueId
        loading = true
        defer { if mine == request { loading = false } }
        do {
            var fresh: AppTeam = try await api.get("api/app/my-team/", query: league.map { [URLQueryItem(name: "league", value: $0)] } ?? [])
            // Noted even from an answer that is late by now: the logout it causes starts the next load before this
            // one is back, and that one only hears "none".
            if fresh.signedOut == "expired" {
                expired = true
                if team?.signedOut != nil { team?.signedOut = "expired" }
            }
            guard mine == request else { return }
            if fresh.signedOut == nil { if fresh.error == nil { expired = false } }
            else if expired { fresh.signedOut = "expired" }
            message = fresh.error
            // Kickbase not reachable: the team on screen stays, with the message above it.
            if fresh.error != nil, fresh.signedOut == nil, team?.players.isEmpty == false { return }
            team = fresh
            if fresh.signedOut == nil, fresh.error == nil, let data = try? JSONEncoder.site.encode(fresh) {
                try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
                try? data.write(to: file(league), options: .atomic)
                if league == nil { try? data.write(to: file(fresh.leagueId), options: .atomic) }
            }
        } catch {
            if mine == request { message = (error as? APIError)?.message }
        }
    }

    func choose(league: String) async {
        leagueId = league
        if let data = try? Data(contentsOf: file(league)), let cached = try? JSONDecoder.site.decode(AppTeam.self, from: data) { team = cached }
        await load()
    }

    /// The Kickbase login came or went (here, in Einstellungen or by the site). Signed out: the old team goes, from
    /// the screen and the phone. Either way the answer for the session as it is now follows.
    func accountChanged(signedIn: Bool) async {
        if signedIn { expired = false } else { clear() }
        await load()
    }

    /// Signed out: nothing of the old account stays on screen or on the phone.
    func clear() {
        request += 1
        // The login prompt stays as it is (it may say that the session ran out); only an account's team goes.
        if team?.signedOut == nil { team = nil }
        leagueId = nil
        message = nil
        Self.forget(directory)
    }

    /// A match runs, or one should have started (its kickoff passed): src/lib/livePoints.ts anyRunning.
    static func running(_ team: AppTeam, now: Date = .now) -> Bool {
        team.players.values.contains { p in
            guard let live = p.live else { return false }
            return live.state == 1 || (live.state == 0 && (live.kickoff.map { $0 <= now } ?? false))
        }
    }

    /// The live points while a match runs (GET /api/kickbase/live/?league=…).
    func pollLive() async {
        while !Task.isCancelled {
            try? await Task.sleep(for: .seconds(30))
            guard let shown = team, Self.running(shown), let league = shown.leagueId else { continue }
            guard let live: LiveAnswer = try? await api.get("api/kickbase/live/", query: [URLQueryItem(name: "league", value: league)]) else { continue }
            // Applied to what's on screen now, and only if it's still that league.
            guard var next = team, next.leagueId == league else { continue }
            for (id, l) in live.players { next.players[id]?.live = l }
            if let points = live.points { next.points = points }
            next.started = next.lines.flatMap { $0 }.contains { (next.players[$0]?.live?.state ?? 0) > 0 }
            next.running = Self.running(next)
            team = next
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
