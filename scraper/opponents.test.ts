import { describe, expect, it } from "vitest";
import { fillOpponents } from "./opponents.ts";
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
