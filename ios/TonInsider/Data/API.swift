import Foundation

enum APIError: Error, Equatable {
    /// Not signed in (or the session ran out); the site's message, e.g. "Melde dich mit LigaInsider an."
    case unauthorized(String?)
    /// The site's German error message, or a general one.
    case server(String)
    case offline

    var message: String {
        switch self {
        case .unauthorized(let m): m ?? "Bitte melde dich an."
        case .server(let m): m
        case .offline: "Keine Verbindung. Versuch es gleich nochmal."
        }
    }
}

/// The site's API, as the app: every request says so (X-TonInsider-App) and carries the session token; a new token
/// in the answer replaces the stored one (src/lib/appSession.ts). Redirects aren't followed: logins answer with one.
final class API: Sendable {
    static let shared: API = {
        let tokens = KeychainTokenStore()
        #if DEBUG
        // Screenshots in the simulator: launch with -TIToken <a session token>.
        if let token = UserDefaults.standard.string(forKey: "TIToken") { tokens.token = token }
        #endif
        return API(session: URLSession(configuration: .ephemeral), tokens: tokens)
    }()

    private let session: URLSession
    private let tokens: TokenStore
    private let noRedirects = NoRedirects()
    private let sessionListener = Locked<(@Sendable (Set<String>) async -> Void)?>(nil)

    /// Called with the logins the session holds ("kb", "li") whenever the site says (X-App-Session).
    func onSession(_ listener: @escaping @Sendable (Set<String>) async -> Void) { sessionListener.value = listener }

    init(session: URLSession, tokens: TokenStore) {
        self.session = session
        self.tokens = tokens
    }

    var isSignedIn: Bool { tokens.token != nil }

    func get<T: Decodable>(_ path: String, query: [URLQueryItem] = []) async throws -> T {
        var request = URLRequest(url: url(path, query))
        request.cachePolicy = .reloadIgnoringLocalCacheData
        return try decode(try await send(request))
    }

    func post<T: Decodable>(_ path: String, json: some Encodable) async throws -> T {
        var request = URLRequest(url: url(path, []))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(json)
        return try decode(try await send(request))
    }

    /// A form post as the site's login and logout forms send it; the answer is a redirect (status and Location).
    func postForm(_ path: String, fields: [String: String]) async throws -> (status: Int, location: String?) {
        var request = URLRequest(url: url(path, []))
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-._~")
        request.httpBody = Data(fields.sorted { $0.key < $1.key }.map { key, value in
            "\(key)=\(value.addingPercentEncoding(withAllowedCharacters: allowed) ?? "")"
        }.joined(separator: "&").utf8)
        let (_, response) = try await send(request)
        return (response.statusCode, response.value(forHTTPHeaderField: "Location"))
    }

    private func url(_ path: String, _ query: [URLQueryItem]) -> URL {
        let url = AppConfig.siteURL.appending(path: path)
        return query.isEmpty ? url : url.appending(queryItems: query)
    }

    private func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        var request = request
        request.setValue("1", forHTTPHeaderField: "X-TonInsider-App")
        let sent = tokens.token
        if let sent { request.setValue("Bearer \(sent)", forHTTPHeaderField: "Authorization") }
        let data: Data, response: URLResponse
        do {
            (data, response) = try await session.data(for: request, delegate: noRedirects)
        } catch {
            throw APIError.offline
        }
        guard let http = response as? HTTPURLResponse else { throw APIError.offline }
        if let fresh = http.value(forHTTPHeaderField: "X-App-Token") { tokens.replace(old: sent, new: fresh) }
        if let flags = http.value(forHTTPHeaderField: "X-App-Session"), let listener = sessionListener.value {
            await listener(Set(flags.split(separator: ",").map(String.init)))
        }
        return (data, http)
    }

    private func decode<T: Decodable>(_ answer: (Data, HTTPURLResponse)) throws -> T {
        let (data, response) = answer
        let message = (try? JSONDecoder().decode(ErrorBody.self, from: data))?.error
        switch response.statusCode {
        case 200..<300: return try JSONDecoder.site.decode(T.self, from: data)
        case 401: throw APIError.unauthorized(message)
        default: throw APIError.server(message ?? "Etwas ist schiefgegangen. Versuch es gleich nochmal.")
        }
    }

    private struct ErrorBody: Decodable { let error: String? }
}

private final class NoRedirects: NSObject, URLSessionTaskDelegate, Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest) async -> URLRequest? { nil }
}

/// A value behind a lock (the API is shared across threads).
final class Locked<T>: @unchecked Sendable {
    private let lock = NSLock()
    private var stored: T
    init(_ value: T) { stored = value }
    var value: T {
        get { lock.withLock { stored } }
        set { lock.withLock { stored = newValue } }
    }
}
