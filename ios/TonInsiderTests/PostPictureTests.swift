import Foundation
import Testing
@testable import TonInsider

/// The picture beside a post (src/lib/postPicture.ts): photo, else crest, else our logo.
struct PostPictureTests {
    private let bayern = ClubRef(id: 1, slug: "fc-bayern-muenchen", name: "FC Bayern München", crest: "/img/clubs/1.png")
    /// LigaInsider files the national teams' news under a "club" we have no crest for.
    private let germany = ClubRef(id: 6998, slug: "deutschland", name: "Deutschland", crest: nil)
    private let kiala = PlayerRef(id: 9, slug: "cassiano-kiala", name: "Cassiano Kiala", photo: "/img/players/9.jpg")

    private func article(player: PlayerRef? = nil, club: ClubRef? = nil, own: Bool? = nil) -> Article {
        Article(id: 1, url: "", headline: "x", newsType: .sonstiges, player: player, club: club, author: nil, source: nil,
                publishedAt: .now, bodyHtml: "", ratings: nil, banner: nil, own: own, bannerSize: nil, pinnedUntil: nil)
    }

    @Test func playerNewsShowsHisPhotoWithHisClubsCrest() {
        #expect(article(player: kiala, club: bayern).picture == .player(kiala, crest: "/img/clubs/1.png", top: false))
    }

    @Test func clubNewsShowsItsCrest() {
        #expect(article(club: bayern).picture == .crest("/img/clubs/1.png"))
    }

    @Test func aClubWithoutCrestShowsOurLogoNotAnEmptySpace() {
        #expect(article(club: germany).picture == .logo)
    }

    @Test func neitherPlayerNorClubShowsOurLogo() {
        #expect(article().picture == .logo)
    }

    @Test func ownPlayerNewsWithoutPhotoShowsTheCrestElseOurLogo() {
        let noPhoto = PlayerRef(id: 9, slug: "x", name: "Kevin Loibl", photo: nil)
        #expect(article(player: noPhoto, club: bayern, own: true).picture == .crest("/img/clubs/1.png"))
        #expect(article(player: noPhoto, club: germany, own: true).picture == .logo)
    }
}
