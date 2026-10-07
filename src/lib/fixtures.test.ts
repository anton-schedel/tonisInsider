import { describe, it, expect } from "vitest";
import { toFixtures } from "./fixtures.ts";
import type { Lineup } from "../../scraper/types.ts";

const lineup = (slug: string, name: string, opponent: string, home: boolean, kickoff?: string): Lineup => ({
  club: { id: slug.length, slug, name },
  opponent: { name: opponent, home },
  kickoff,
  matchday: 5,
  formation: "4-4-2",
  lines: [],
  updatedAt: "x",
});

const bvb = lineup("bvb", "Borussia Dortmund", "SV Werder Bremen", true, "2026-10-09T18:30:00.000Z");
const svw = lineup("svw", "SV Werder Bremen", "Borussia Dortmund", false, "2026-10-09T18:30:00.000Z");
const tsg = lineup("tsg", "TSG Hoffenheim", "Hamburger SV", true, "2026-10-10T13:30:00.000Z");
const hsv = lineup("hsv", "Hamburger SV", "TSG Hoffenheim", false, "2026-10-10T13:30:00.000Z");

describe("toFixtures", () => {
  it("pairs both sides of a match, home team first", () => {
    expect(toFixtures([svw, bvb])).toEqual([
      { home: bvb, away: svw, homeName: "Borussia Dortmund", awayName: "SV Werder Bremen", kickoff: bvb.kickoff },
    ]);
  });

  it("sorts fixtures by kickoff", () => {
    expect(toFixtures([hsv, tsg, svw, bvb]).map((f) => f.homeName)).toEqual(["Borussia Dortmund", "TSG Hoffenheim"]);
  });

  it("keeps a team whose opponent has no lineup, using the opponent's name", () => {
    expect(toFixtures([tsg])).toEqual([
      { home: tsg, away: undefined, homeName: "TSG Hoffenheim", awayName: "Hamburger SV", kickoff: tsg.kickoff },
    ]);
    expect(toFixtures([hsv])[0]).toMatchObject({ home: undefined, away: hsv, homeName: "TSG Hoffenheim" });
  });

  it("puts lineups without an opponent last", () => {
    const none = { ...lineup("x", "X", "", true), opponent: undefined };
    expect(toFixtures([none, bvb, svw]).map((f) => f.homeName)).toEqual(["Borussia Dortmund", "X"]);
  });
});
