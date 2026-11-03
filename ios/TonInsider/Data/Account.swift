import Foundation
import Observation

/// Who is signed in, as far as the phone knows: the session itself is the token (API); these are the flags and names
/// the website keeps in readable cookies. Mein Team corrects the Kickbase part whenever it loads.
@Observable @MainActor
final class Account {
    var kickbase: Bool { didSet { save() } }
    var kickbaseName: String? { didSet { save() } }
    var ligaInsider: Bool { didSet { save() } }
    var ligaInsiderName: String? { didSet { save() } }

    private let defaults: UserDefaults
    let api: API

    init(api: API = .shared, defaults: UserDefaults = .standard) {
        self.api = api
        self.defaults = defaults
        kickbase = defaults.bool(forKey: "kb")
        kickbaseName = defaults.string(forKey: "kbName")
        ligaInsider = defaults.bool(forKey: "li")
        ligaInsiderName = defaults.string(forKey: "liName")
        // Every answer of the site says which logins the session holds: the flags follow it.
        api.onSession { [weak self] flags in await self?.follow(flags) }
    }

    private func follow(_ flags: Set<String>) {
        if kickbase != flags.contains("kb") { kickbase = flags.contains("kb") }
        if !kickbase { kickbaseName = nil }
        if ligaInsider != flags.contains("li") { ligaInsider = flags.contains("li") }
        if !ligaInsider { ligaInsiderName = nil }
    }

    private func save() {
        defaults.set(kickbase, forKey: "kb")
        defaults.set(kickbaseName, forKey: "kbName")
        defaults.set(ligaInsider, forKey: "li")
        defaults.set(ligaInsiderName, forKey: "liName")
    }

    /// The website's messages after a failed login (src/pages/einstellungen.astro).
    static let errors = [
        "credentials": "Kickbase: E-Mail oder Passwort falsch.",
        "expired": "Deine Kickbase-Sitzung ist abgelaufen. Bitte melde dich erneut an.",
        "unavailable": "Kickbase ist gerade nicht erreichbar. Versuch es gleich nochmal.",
        "li-credentials": "LigaInsider: Benutzername oder Passwort falsch.",
        "li-unavailable": "LigaInsider ist gerade nicht erreichbar. Versuch es gleich nochmal.",
    ]

    /// nil when it worked, else the message to show.
    func logInKickbase(email: String, password: String) async -> String? {
        do {
            let result = try await api.postForm("api/login/", fields: ["email": email, "password": password])
            if let error = Self.error(in: result.location) { return error }
            guard result.location?.hasPrefix("/mein-team/") == true else { return Self.errors["unavailable"] }
            kickbase = true
            Analytics.capture("kickbase_login_succeeded")
            if let team: AppTeam = try? await api.get("api/app/my-team/") { update(from: team) }
            return nil
        } catch {
            return (error as? APIError)?.message ?? Self.errors["unavailable"]
        }
    }

    func logInLigaInsider(username: String, password: String) async -> String? {
        do {
            let result = try await api.postForm("api/li-login/", fields: ["username": username, "password": password, "next": "/"])
            if let error = Self.error(in: result.location) { return error }
            guard result.status == 303, result.location == "/" else { return Self.errors["li-unavailable"] }
            ligaInsider = true
            ligaInsiderName = username.trimmingCharacters(in: .whitespaces)
            return nil
        } catch {
            return (error as? APIError)?.message ?? Self.errors["li-unavailable"]
        }
    }

    /// nil when it worked; else the message (the session stays: the phone can't change the sealed token itself).
    @discardableResult
    func logOutKickbase() async -> String? {
        await logOut("api/logout/") { $0.kickbase = false; $0.kickbaseName = nil }
    }

    @discardableResult
    func logOutLigaInsider() async -> String? {
        await logOut("api/li-logout/") { $0.ligaInsider = false; $0.ligaInsiderName = nil }
    }

    private func logOut(_ path: String, done: (Account) -> Void) async -> String? {
        do {
            let result = try await api.postForm(path, fields: ["next": "/"])
            guard result.status == 303 else { return "Abmelden hat nicht geklappt. Versuch es gleich nochmal." }
            done(self)
            return nil
        } catch {
            return (error as? APIError)?.message ?? APIError.offline.message
        }
    }

    /// Mein Team knows best whether the Kickbase session still holds.
    func update(from team: AppTeam) {
        if team.signedOut != nil { kickbase = false; kickbaseName = nil; return }
        if team.error == nil { kickbase = true }
        if let name = team.account?.name { kickbaseName = name }
        Analytics.identify(team.account?.userId)
    }

    private static func error(in location: String?) -> String? {
        guard let location, let items = URLComponents(string: location)?.queryItems,
              let code = items.first(where: { $0.name == "error" })?.value else { return nil }
        return errors[code] ?? errors["unavailable"]
    }
}
