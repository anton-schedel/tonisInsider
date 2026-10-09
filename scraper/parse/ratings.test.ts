import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArticle } from "./article.ts";

const fx = (name: string) => readFileSync(join(import.meta.dirname, "..", "__fixtures__", name), "utf8");
const ref = {
  id: 418930,
  url: "https://www.ligainsider.de/borussia-dortmund/14/bvb-verspielt-spaete-zwei-tore-fuehrung-gegen-bremen-418930/",
  headline: "BVB verspielt späte Zwei-Tore-Führung gegen Bremen",
  newsType: "sonstiges" as const,
};

describe("match report grades", () => {
  const a = parseArticle(fx("article-grades.html"), ref, "bundesliga", new Date("2026-10-09T21:00:00Z"));

  it("reads both teams with their average grade", () => {
    expect(a.ratings?.map((t) => [t.team, t.average])).toEqual([["Borussia Dortmund", 3.43], ["SV Werder Bremen", 3.81]]);
  });

  it("reads the XI line by line with grades, goals and assists", () => {
    const bvb = a.ratings![0];
    expect(bvb.lines.map((l) => l.length)).toEqual([1, 3, 4, 3]);
    expect(bvb.lines[0][0].player).toMatchObject({ name: "Kobel", slug: "gregor-kobel", id: 9357, grade: 4.5, marks: [] });
    expect(bvb.lines[1][2].player).toMatchObject({ name: "N. Schlotterbeck", grade: 3, marks: ["goal", "error"] });
    expect(bvb.lines[0][0].player.photoUrl).toMatch(/gregor-kobel-dortmund/);
  });

  it("puts a substitute on the spot of the player he replaced, with the minute and his own marks", () => {
    const spot = a.ratings![0].lines[2][1];
    expect(spot.player).toMatchObject({ name: "Jobe", grade: 4 });
    expect(spot.minute).toBe(72);
    expect(spot.sub).toMatchObject({ name: "Veerman", grade: 3.5, marks: ["assist", "yellow"] });
  });

  it("keeps a missing grade missing (played too briefly)", () => {
    const spot = a.ratings![1].lines[2].find((s) => s.player.name === "Chuki")!;
    expect(spot.sub).toMatchObject({ name: "Erevbenagie" });
    expect(spot.sub?.grade).toBeUndefined();
  });

  it("drops the grade markup from the text", () => {
    expect(a.bodyHtml).toContain("Tore:");
    expect(a.bodyHtml).not.toMatch(/PARADEN|Aufstellung von Borussia/);
  });
});
