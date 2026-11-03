import Foundation
import Testing
@testable import TonInsider

extension NetworkTests {
    @Suite(.serialized) @MainActor
    struct ScoutTests {
        private func store(signedIn: Bool) -> (ScoutStore, UserDefaults) {
            let defaults = UserDefaults(suiteName: UUID().uuidString)!
            let api = API(session: StubProtocol.session(), tokens: MemoryTokenStore())
            return (ScoutStore(api: api, defaults: defaults, signedIn: { signedIn }), defaults)
        }

        @Test func localListWithoutLogin() async {
            let calls = Box(0)
            StubProtocol.handler = { _ in calls.value += 1; return (response(401), Data(#"{"account":false}"#.utf8)) }
            let (store, defaults) = store(signedIn: false)
            await store.set(7, on: true)
            #expect(store.state.ids == [7])
            #expect(!store.state.account)
            #expect(calls.value == 0)
            // Still there after a restart.
            let again = ScoutStore(api: API(session: StubProtocol.session(), tokens: MemoryTokenStore()), defaults: defaults, signedIn: { false })
            await again.load()
            #expect(again.state.ids == [7])
        }

        @Test func mergesLocalListOnLogin() async {
            let (local, defaults) = store(signedIn: false)
            await local.set(7, on: true)
            let posted = Box<String?>(nil)
            StubProtocol.handler = { request in
                if request.httpMethod == "POST" {
                    posted.value = request.httpBodyStream.map { s in
                        s.open(); defer { s.close() }
                        var buf = [UInt8](repeating: 0, count: 256); let n = s.read(&buf, maxLength: 256)
                        return String(decoding: buf.prefix(max(0, n)), as: UTF8.self)
                    }
                    return (response(200), Data(#"{"account":true,"ids":[7,3],"added":{}}"#.utf8))
                }
                return (response(200), Data(#"{"account":true,"ids":[3],"added":{}}"#.utf8))
            }
            let server = ScoutStore(api: API(session: StubProtocol.session(), tokens: MemoryTokenStore()), defaults: defaults, signedIn: { true })
            await server.load()
            #expect(posted.value?.contains("\"add\":[7]") == true)
            #expect(server.state.ids == [7, 3] && server.state.account)
            #expect(defaults.array(forKey: "scoutList") == nil)
        }

        @Test func badgeCountsNewsAfterSeenAt() throws {
            let feed = try AppFeed.decode(try fixture("app-feed"))
            // Kimmich (3) has news on 2 Nov 10:00; Kane (1) on 1 Nov 23:30.
            var state = ScoutState(ids: [3, 1], added: [:], seenAt: ISO8601DateFormatter().date(from: "2026-11-02T00:00:00Z"), account: false)
            #expect(state.unseen(in: feed) == [3])
            state.added["3"] = ISO8601DateFormatter().date(from: "2026-11-02T12:00:00Z")
            #expect(state.unseen(in: feed).isEmpty)
        }
    }
}
