import Foundation
import Testing
@testable import TonInsider

extension NetworkTests {
    @Suite(.serialized) @MainActor
    struct MyTeamTests {
        @Test func decodesAppTeam() throws {
            let team = try JSONDecoder.site.decode(AppTeam.self, from: try fixture("my-team"))
            #expect(team.lines.flatMap { $0 }.count + team.bench.count == team.players.count)
            let first = try #require(team.players[team.lines.last!.first!])
            #expect(first.card.status != nil)
            #expect(first.status == .start || first.status != nil)
            #expect(team.summary?.games.first?.players.first?.note == "lebt von Toren, 2,0 Tore erwartet")
            #expect(team.points == 42)
        }

        @Test func favouriteBarIsGoldFrom55() {
            #expect(GameRowView.isFavourite(55))
            #expect(!GameRowView.isFavourite(54))
        }

        @Test func signedOutShowsTheLoginPrompt() async throws {
            StubProtocol.handler = { _ in (response(200), Data(#"{"signedOut":"none","leagues":[],"started":false,"running":false,"formation":"0-0-0","lines":[],"bench":[],"players":{}}"#.utf8)) }
            let dir = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
            let model = MyTeamModel(api: API(session: StubProtocol.session(), tokens: MemoryTokenStore()), directory: dir)
            await model.load()
            #expect(model.team?.signedOut == "none")
            #expect(model.showsLoginPrompt)
        }

        @Test func keepsTheLastTeamPerLeagueOnThePhone() async throws {
            StubProtocol.handler = { _ in (response(200), try fixture("my-team")) }
            let dir = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
            let api = API(session: StubProtocol.session(), tokens: MemoryTokenStore())
            let model = MyTeamModel(api: api, directory: dir)
            await model.load()
            let again = MyTeamModel(api: api, directory: dir)
            again.loadCached()
            #expect(again.team?.players.count == model.team?.players.count)
        }
    }
}
