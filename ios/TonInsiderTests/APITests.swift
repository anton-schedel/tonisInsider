import Foundation
import Testing
@testable import TonInsider

extension NetworkTests {
    @Suite(.serialized)
    struct APITests {
        private struct Echo: Decodable { let ok: Bool }

        private func api(token: String? = nil) -> (API, MemoryTokenStore) {
            let store = MemoryTokenStore(token)
            return (API(session: StubProtocol.session(), tokens: store), store)
        }

        @Test func sendsAppHeaderAndToken() async throws {
            let seen = Box<URLRequest?>(nil)
            StubProtocol.handler = { request in seen.value = request; return (response(200), Data(#"{"ok":true}"#.utf8)) }
            let (api, _) = api(token: "T1")
            let echo: Echo = try await api.get("api/scout/")
            #expect(echo.ok)
            #expect(seen.value?.value(forHTTPHeaderField: "X-TonInsider-App") == "1")
            #expect(seen.value?.value(forHTTPHeaderField: "Authorization") == "Bearer T1")
            #expect(seen.value?.url?.path() == "/api/scout/")
        }

        @Test func storesARotatedToken() async throws {
            StubProtocol.handler = { _ in (response(200, ["X-App-Token": "T2"]), Data(#"{"ok":true}"#.utf8)) }
            let (api, store) = api(token: "T1")
            let _: Echo = try await api.get("api/scout/")
            #expect(store.token == "T2")
        }

        @Test func keepsTheTokenWhenNoneComesBack() async throws {
            StubProtocol.handler = { _ in (response(200), Data(#"{"ok":true}"#.utf8)) }
            let (api, store) = api(token: "T1")
            let _: Echo = try await api.get("api/scout/")
            #expect(store.token == "T1")
        }

        @Test func doesNotFollowRedirects() async throws {
            let body = Box<String?>(nil)
            StubProtocol.handler = { request in
                body.value = request.httpBodyStream.map { stream in
                    stream.open(); defer { stream.close() }
                    var data = Data(); var buffer = [UInt8](repeating: 0, count: 1024)
                    while stream.hasBytesAvailable { let n = stream.read(&buffer, maxLength: 1024); if n <= 0 { break }; data.append(buffer, count: n) }
                    return String(decoding: data, as: UTF8.self)
                }
                return (response(303, ["Location": "/einstellungen/?error=credentials", "X-App-Token": "T3"]), Data())
            }
            let (api, store) = api()
            let result = try await api.postForm("api/login/", fields: ["email": "a@b.de", "password": "p&w"])
            #expect(result.status == 303)
            #expect(result.location == "/einstellungen/?error=credentials")
            #expect(store.token == "T3")
            #expect(body.value?.contains("password=p%26w") == true)
        }

        @Test func mapsTheSitesErrorMessage() async throws {
            StubProtocol.handler = { _ in (response(401), Data(#"{"error":"Melde dich mit LigaInsider an."}"#.utf8)) }
            let (api, _) = api()
            await #expect(throws: APIError.unauthorized("Melde dich mit LigaInsider an.")) {
                let _: Echo = try await api.post("api/li-comment/", json: ["x": 1])
            }
            StubProtocol.handler = { _ in (response(400), Data(#"{"error":"Zu lang."}"#.utf8)) }
            await #expect(throws: APIError.server("Zu lang.")) {
                let _: Echo = try await api.post("api/li-comment/", json: ["x": 1])
            }
        }
    }
}
