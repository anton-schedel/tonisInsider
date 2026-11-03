import Foundation
import Testing
@testable import TonInsider

struct ArticleBodyTests {
    private func text(_ block: ArticleBlock) -> String {
        switch block {
        case .paragraph(let s): String(s.characters)
        case .heading(let s): s
        }
    }

    @Test func boldAndItalicRuns() throws {
        let blocks = articleBlocks("<p>Ein <b>fetter</b> und <i>schräger</i> Satz.</p>")
        #expect(blocks.count == 1)
        guard case .paragraph(let s) = blocks[0] else { Issue.record("no paragraph"); return }
        #expect(String(s.characters) == "Ein fetter und schräger Satz.")
        let bold = s.runs.first { String(s[$0.range].characters) == "fetter" }
        #expect(bold?.inlinePresentationIntent == .stronglyEmphasized)
        let italic = s.runs.first { String(s[$0.range].characters) == "schräger" }
        #expect(italic?.inlinePresentationIntent == .emphasized)
    }

    @Test func lineBreaksStayInsideTheParagraph() {
        let blocks = articleBlocks("<p>Startelf: A, B<br>Bank: C</p>")
        #expect(blocks.map(text) == ["Startelf: A, B\nBank: C"])
    }

    @Test func h3BecomesHeading() {
        let blocks = articleBlocks("<h3>Fazit</h3><p>Gut.</p>")
        guard case .heading(let h) = blocks.first else { Issue.record("no heading"); return }
        #expect(h == "Fazit")
        #expect(blocks.count == 2)
    }

    @Test func linksKeepTheirURL() {
        let blocks = articleBlocks(#"<p>Siehe <a href="https://example.com/x">hier</a>.</p>"#)
        guard case .paragraph(let s) = blocks.first else { Issue.record("no paragraph"); return }
        let link = s.runs.first { $0.link != nil }
        #expect(link?.link == URL(string: "https://example.com/x"))
        #expect(String(s[link!.range].characters) == "hier")
    }

    @Test func entitiesAreDecoded() {
        let blocks = articleBlocks("<p>A &amp; B &quot;C&quot;&nbsp;D &#8211; E</p>")
        #expect(blocks.map(text) == ["A & B \"C\"\u{a0}D – E"])
    }

    @Test func textOutsideParagraphsAndEmptyParagraphs() {
        #expect(articleBlocks("Lose <p> </p><p>Text</p>").map(text) == ["Lose", "Text"])
    }

    @Test func confirmedLineupPosts() {
        let xi = confirmedLineup(url: "https://www.ligainsider.de/aufstellung-von-borussia-dortmund_1/",
                                 bodyHtml: "<p>Startelf: Kobel - Ryerson<br/>Bank: Meyer</p>")
        #expect(xi?.xi == "Kobel - Ryerson")
        #expect(xi?.bench == "Meyer")
        #expect(confirmedLineup(url: "https://www.ligainsider.de/news_1/", bodyHtml: "<p>Startelf: X</p>") == nil)
    }

    @Test func dayLabels() {
        let now = ISO8601DateFormatter().date(from: "2026-11-03T12:00:00Z")!
        #expect(Berlin.dayLabel(now, now: now) == "Heute · Di. 03.11.")
        #expect(Berlin.dayLabel(now.addingTimeInterval(-86400), now: now) == "Gestern · Mo. 02.11.")
        #expect(Berlin.dayLabel(now.addingTimeInterval(-3 * 86400), now: now) == "Sa. 31.10.")
        #expect(Berlin.time(now) == "13:00")
    }
}
