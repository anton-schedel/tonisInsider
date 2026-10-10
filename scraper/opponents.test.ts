import { describe, expect, it } from "vitest";
import { fillFromSchedule, fillOpponents } from "./opponents.ts";
import type { Lineup } from "./types.ts";

const lineup = (name: string, opponent?: Lineup["opponent"], kickoff?: string): Lineup => ({
  club: { id: name.length, slug: name.toLowerCase(), name },
  opponent,
  kickoff,
  matchday: opponent ? 6 : undefined,
  formation: "4-4-2",
  lines: [],
  updatedAt: "x",
});

describe("fillOpponents", () => {
  it("names the opponent from the other side's page", () => {
    const mainz = lineup("Mainz", { name: "Leverkusen", home: true }, "2026-10-10T13:30:00.000Z");
    const b04 = lineup("Leverkusen");
    expect(fillOpponents([mainz, b04])).toEqual([b04]);
    expect(b04).toMatchObject({ opponent: { name: "Mainz", home: false }, kickoff: mainz.kickoff, matchday: 6 });
  });
  it("leaves clubs alone that nobody plays", () => {
    const hsv = lineup("HSV");
    expect(fillOpponents([hsv, lineup("TSG")])).toEqual([]);
    expect(hsv.opponent).toBeUndefined();
  });
});

describe("fillFromSchedule", () => {
  it("takes the opponent and kickoff from the schedule when no page names them", () => {
    const scp = lineup("Paderborn");
    const vfb = lineup("Stuttgart");
    const games = [{ home: "Paderborn", away: "Stuttgart", kickoff: "2026-10-10T13:30:00.000Z" }];
    expect(fillFromSchedule([scp, vfb], games)).toEqual([scp, vfb]);
    expect(scp).toMatchObject({ opponent: { name: "Stuttgart", home: true }, kickoff: games[0].kickoff });
    expect(vfb).toMatchObject({ opponent: { name: "Paderborn", home: false } });
  });
  it("keeps what a page already said", () => {
    const mainz = lineup("Mainz", { name: "Leverkusen", home: true });
    expect(fillFromSchedule([mainz], [{ home: "Mainz", away: "Köln", kickoff: "x" }])).toEqual([]);
  });
});
