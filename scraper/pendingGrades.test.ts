import { describe, expect, it } from "vitest";
import { hasGrades, pendingGrades, withoutPendingHeadings } from "./pendingGrades.ts";

// The forms stored in the live snapshot (2026-11-09) for reports read before LigaInsider filled in the grades.
const waiting = '<p>Tore: …</p>\n<h3>Aufstellung von Borussia Dortmund</h3><br>\n<h3></h3><br>\n<h3>Aufstellung der SV 07 Elversberg</h3><br>\n<h3></h3><br>\n';
const colons = "<p>…</p>\n<h3>Aufstellung des Hamburger SV:</h3><br>\n<h3>Aufstellung von Borussia Mönchengladbach:</h3><br>\n";
// Some cup and Champions League reports give the lineup as text after the heading: no grades will come.
const plainText = "<p>…</p>\n<h3>Aufstellung von Bayer 04 Leverkusen</h3><p>Flekken – Quansah, Tapsoba …</p>";
const rated = (grade?: number) => [{ team: "BVB", lines: [[{ player: { id: 1, slug: "a", name: "A", ...(grade !== undefined ? { grade } : {}), marks: [] } }]] }];

describe("pendingGrades", () => {
  it("waiting: empty grade headings, with or without colon", () => {
    expect(pendingGrades({ bodyHtml: waiting })).toBe(true);
    expect(pendingGrades({ bodyHtml: colons })).toBe(true);
  });

  it("not waiting: grades in, a lineup as plain text, or no grade heading at all", () => {
    expect(pendingGrades({ bodyHtml: waiting, ratings: rated(2.5) })).toBe(false);
    expect(pendingGrades({ bodyHtml: plainText })).toBe(false);
    expect(pendingGrades({ bodyHtml: "<p>Kobel bleibt.</p>" })).toBe(false);
    // The weekly LigaInsider-Topelf and friendly matches show a pitch without grades: none will come.
    expect(pendingGrades({ bodyHtml: "<p>x</p>", ratings: rated() })).toBe(false);
  });

  it("hasGrades: some player (or one who came on) has a grade", () => {
    expect(hasGrades({ ratings: rated(3) })).toBe(true);
    expect(hasGrades({ ratings: rated() })).toBe(false);
    expect(hasGrades({ ratings: [{ team: "BVB", lines: [[{ player: { id: 1, slug: "a", name: "A", marks: [] }, sub: { id: 2, slug: "b", name: "B", grade: 3.5, marks: [] } }]] }] })).toBe(true);
    expect(hasGrades({})).toBe(false);
  });
});

describe("withoutPendingHeadings", () => {
  it("the empty headings (and their empty partners) go, everything else stays", () => {
    expect(withoutPendingHeadings(waiting)).toBe("<p>Tore: …</p>\n");
    expect(withoutPendingHeadings(colons)).toBe("<p>…</p>\n");
    expect(withoutPendingHeadings(plainText)).toBe(plainText);
  });
});
