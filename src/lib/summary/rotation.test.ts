import { describe, expect, it } from "vitest";
import { cupGameNear, rotationRisk } from "./rotation.ts";
import type { HistGame, HistMatch, HistPlayer } from "../../../scraper/kbHistory.ts";
import type { CupGame } from "../../../scraper/cupGames.ts";

/** Day n of the season: 1 = 1 Sep 2026. */
const at = (day: number) => new Date(Date.UTC(2026, 8, day, 13, 30)).toISOString();
const cup = (day: number): CupGame => ({ id: `c${day}`, competition: "Champions League", kickoff: at(day), home: "Atlético Madrid", away: "Bayern Munich" });
// Bundesliga games a week apart (Bayern = Kickbase team "2"); the coming one on day 43.
const DAYS = [1, 8, 15, 22, 29, 36];
const matches: Record<string, HistMatch> = Object.fromEntries(DAYS.map((d) => [`m${d}`, { day: d, date: at(d), home: "2", away: "3", homeGoals: 1, awayGoals: 0 }]));
const player = (startedOn: number[]): HistPlayer => ({
  name: "Laimer", team: "2", position: 3,
  games: DAYS.map((d): HistGame => ({ day: d, matchId: `m${d}`, team: "2", minutes: startedOn.includes(d) ? 90 : 0, start: startedOn.includes(d), points: 0 })),
});
const UPCOMING = at(43);

describe("cupGameNear", () => {
  it("finds the club's game within three days, by the cup list's spelling", () => {
    expect(cupGameNear([cup(41)], "Bayern", UPCOMING)?.id).toBe("c41");
    expect(cupGameNear([cup(39)], "Bayern", UPCOMING)).toBeUndefined();
    expect(cupGameNear([cup(41)], "Dortmund", UPCOMING)).toBeUndefined();
  });
});

describe("rotationRisk", () => {
  it("warns when he started less often next to such games", () => {
    // Cup games next to days 8 and 22; he started all the others but neither of those.
    const r = rotationRisk(player([1, 15, 29, 36]), "Bayern", matches, [cup(10), cup(24), cup(41)], UPCOMING);
    expect(r).toEqual({ near: cup(41), nearStarts: 0, nearGames: 2, usualRate: 1 });
  });

  it("says nothing without a cup game this week", () => {
    expect(rotationRisk(player([1, 15, 29, 36]), "Bayern", matches, [cup(10), cup(24)], UPCOMING)).toBeUndefined();
  });

  it("needs two such games before", () => {
    expect(rotationRisk(player([1, 15, 22, 29, 36]), "Bayern", matches, [cup(10), cup(41)], UPCOMING)).toBeUndefined();
  });

  it("says nothing when he started there about as often as otherwise", () => {
    expect(rotationRisk(player([1, 8, 22, 29, 36]), "Bayern", matches, [cup(10), cup(24), cup(41)], UPCOMING)).toBeUndefined();
  });
});
