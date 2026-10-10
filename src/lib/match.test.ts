import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { normalize, mapClubs, matchPlayer, matchSquad, pitchLines } from "./match.ts";
import type { KbPlayer, KbTeam } from "./kickbase.ts";
import type { Article, Lineup, LineupPlayer } from "../../scraper/types.ts";

const FX = join(import.meta.dirname, "..", "..", "scraper", "__fixtures__");
const json = <T>(name: string) => JSON.parse(readFileSync(join(FX, name), "utf8")) as T;
const table: KbTeam[] = json<{ it: { tid: string; tn: string }[] }>("kickbase-table.json").it.map((t) => ({ id: t.tid, name: t.tn }));
const lineups: Lineup[] = readdirSync(join(FX, "lineups")).map((f) => JSON.parse(readFileSync(join(FX, "lineups", f), "utf8")));

const lp = (id: number, slug: string, name: string, extra: Partial<LineupPlayer> = {}): LineupPlayer => ({ id, slug, name, status: "set", ...extra });
const kb = (name: string, teamId = "3"): KbPlayer => ({ id: "1", name, teamId, position: 3 });
const bvb: Lineup = {
  club: { id: 14, slug: "borussia-dortmund", name: "Borussia Dortmund" },
  formation: "",
  updatedAt: "x",
  lines: [[
    lp(9357, "gregor-kobel", "Kobel"),
    lp(20052, "nico-schlotterbeck", "N. Schlotterbeck", { status: "doubtful", statusLabel: "Angeschlagen", alternative: { id: 7791, slug: "ramy-bensebaini", name: "Bensebaini" } }),
    lp(1, "felix-nmecha", "F. Nmecha"),
    lp(2, "lukas-nmecha", "L. Nmecha"),
    lp(3, "joey-veerman", "Veerman", { alternative: { id: 4, slug: "jobe-bellingham", name: "Jobe" } }),
  ]],
};

describe("normalize", () => {
  it("strips accents, punctuation and case", () => {
    expect(normalize("Kramarić")).toBe("kramaric");
    expect(normalize("M'gladbach")).toBe("m gladbach");
    expect(normalize("Köln")).toBe("koln");
    expect(normalize("Groß")).toBe("gross");
  });
});

describe("mapClubs", () => {
  it("maps all 18 Kickbase teams to exactly one LigaInsider club each", () => {
    const map = mapClubs(table, lineups);
    expect(map.size).toBe(18);
    expect(new Set([...map.values()].map((l) => l.club.slug)).size).toBe(18);
    expect(map.get("15")?.club.slug).toBe("borussia-moenchengladbach");
    expect(map.get("6")?.club.slug).toBe("hamburger-sv");
    expect(map.get("3")?.club.slug).toBe("borussia-dortmund");
  });
});

describe("matchPlayer", () => {
  it("marks a set starter as start, matched by last name", () => {
    expect(matchPlayer(kb("Kobel"), bvb)).toMatchObject({ status: "start", ligainsider: { id: 9357 } });
  });
  it("marks a doubtful starter with its label", () => {
    expect(matchPlayer(kb("Schlotterbeck"), bvb)).toMatchObject({ status: "doubtful", statusLabel: "Angeschlagen" });
  });
  it("marks a starter who has an alternative as contested, with the rival's name", () => {
    expect(matchPlayer(kb("Veerman"), bvb)).toMatchObject({ status: "contested", rival: "Jobe", ligainsider: { name: "Veerman" } });
  });

  it("keeps 'doubtful' for an injured starter but still names the rival", () => {
    expect(matchPlayer(kb("Schlotterbeck"), bvb)).toMatchObject({ status: "doubtful", rival: "Bensebaini" });
  });

  it("marks an alternative", () => {
    expect(matchPlayer(kb("Bensebaini"), bvb)).toMatchObject({ status: "alternative", ligainsider: { id: 7791 } });
  });
  it("marks a known club's player outside the XI as bench", () => {
    expect(matchPlayer(kb("Can"), bvb).status).toBe("bench");
  });
  it("refuses to guess between two players with the same last name", () => {
    expect(matchPlayer(kb("Nmecha"), bvb).status).toBe("unknown");
  });
  it("matches by full name and accents", () => {
    expect(matchPlayer(kb("Felix Nmecha"), bvb)).toMatchObject({ status: "start", ligainsider: { id: 1 } });
  });
  it("does not match a surname against a teammate's first name", () => {
    const withUzun: Lineup = { ...bvb, lines: [[...bvb.lines[0], lp(3, "can-uzun", "Uzun")]] };
    expect(matchPlayer(kb("Can"), withUzun).status).toBe("bench");
  });
  it("refuses to guess when the club's full roster has two players with that surname", () => {
    expect(matchPlayer(kb("Kobel"), bvb, ["Kobel", "Kobel"]).status).toBe("unknown");
    expect(matchPlayer(kb("Kobel"), bvb, ["Kobel", "Anton"]).status).toBe("start");
  });
  it("is unknown without a lineup", () => {
    expect(matchPlayer(kb("Kobel"), undefined).status).toBe("unknown");
  });
});

describe("matchSquad on the recorded squad", () => {
  it("finds a club for every player and LigaInsider ids for those in a predicted XI", () => {
    const squad = json<{ it: { i: string; n: string; tid: string; pos: number }[] }>("kickbase-squad.json").it
      .map((p) => ({ id: p.i, name: p.n, teamId: p.tid, position: p.pos as 1 }));
    const result = matchSquad(squad, mapClubs(table, lineups));
    expect(result.every((p) => p.club)).toBe(true);
    expect(result.filter((p) => p.status !== "bench" && p.status !== "unknown").length).toBeGreaterThanOrEqual(8);
  });
});

describe("pitchLines", () => {
  const p = (name: string, position: 1 | 2 | 3 | 4) =>
    ({ kickbase: { id: name, name, teamId: "1", position }, status: "unknown" }) as const;

  it("groups the XI into goalkeeper, defence, midfield and attack, and names the formation", () => {
    const xi = [p("S1", 4), p("T", 1), p("A1", 2), p("M1", 3), p("A2", 2), p("S2", 4), p("A3", 2), p("A4", 2), p("M2", 3), p("M3", 3), p("M4", 3)];
    const { lines, formation } = pitchLines(xi);
    expect(lines.map((l) => l.map((x) => x.kickbase.name))).toEqual([["T"], ["A1", "A2", "A3", "A4"], ["M1", "M2", "M3", "M4"], ["S1", "S2"]]);
    expect(formation).toBe("4-4-2");
  });

  it("leaves out empty lines (an incomplete lineup)", () => {
    const { lines, formation } = pitchLines([p("T", 1), p("S1", 4)]);
    expect(lines.map((l) => l.length)).toEqual([1, 1]);
    expect(formation).toBe("0-0-1");
  });
});
