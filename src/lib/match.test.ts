import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { normalize, mapClubs, matchPlayer, matchSquad, squadNews } from "./match.ts";
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

describe("squadNews", () => {
  const article = (id: number, player: { id: number; slug: string; name: string }, clubId: number, at: string) =>
    ({ id, player, club: { id: clubId, slug: "c", name: "C" }, publishedAt: at }) as Article;

  it("finds articles by matched id and by name at the same club, newest first", () => {
    const players = [matchPlayer(kb("Kobel"), bvb), matchPlayer(kb("Can"), bvb)];
    const news = squadNews(players, [
      article(1, { id: 9357, slug: "gregor-kobel", name: "Gregor Kobel" }, 14, "2026-10-07T07:00:00Z"),
      article(2, { id: 1812, slug: "emre-can", name: "Emre Can" }, 14, "2026-10-07T09:00:00Z"),
      article(3, { id: 5, slug: "x-can", name: "Xaver Can" }, 99, "2026-10-07T10:00:00Z"),
      article(4, { id: 6, slug: "other", name: "Other Player" }, 14, "2026-10-07T11:00:00Z"),
    ]);
    expect(news.map((a) => a.id)).toEqual([2, 1]);
  });
});
