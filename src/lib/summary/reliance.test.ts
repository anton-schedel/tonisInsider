import { describe, expect, it } from "vitest";
import { relianceNorms, relianceOf, sharesOf } from "./reliance.ts";
import { emptyHistory, type HistGame, type KbHistory } from "../../../scraper/kbHistory.ts";

// 4288 Tor (MF), 4333 Zu Null gespielt (ABW), 4231 Gewonnener Zweikampf, 4240 Ballverlust.
const game = (day: number, events: Record<string, number>, minutes = 90): HistGame => ({ day, matchId: `m${day}`, team: "3", minutes, start: true, points: 0, events });

describe("sharesOf", () => {
  it("is each source's share of his positive points, recent games weighing more", () => {
    // Newest (day 2): all duels; older (day 1, weight 0.85): all goals.
    const s = sharesOf([game(1, { 4288: 100 }), game(2, { 4231: 100, 4240: -5 })]);
    expect(s.goals).toBeCloseTo(85 / 185);
    expect(s.duel).toBeCloseTo(100 / 185);
    expect(s.mistake).toBeUndefined();
  });
});

describe("relianceNorms / relianceOf", () => {
  // Ten defenders: nine with 5 % of their points from clean sheets, one with 30 %.
  const history: KbHistory = { ...emptyHistory(), season: "2026/2027" };
  for (let i = 0; i < 10; i++) {
    history.players[`d${i}`] = { name: `D${i}`, team: "3", position: 2, games: [1, 2, 3, 4].map((d) => game(d, { 4231: i === 9 ? 70 : 95, 4333: i === 9 ? 30 : 5 })) };
  }
  const norms = relianceNorms(history);

  it("is the share of a source that 80 % of the players in that position stay at or below", () => {
    expect(norms.get(2)!.cleansheet).toBeCloseTo(0.05);
  });

  it("says which source a player depends on clearly more than others in his position", () => {
    expect(relianceOf({ cleansheet: 0.3, duel: 0.7 }, 2, norms)).toEqual({ kind: "cleansheet", share: 0.3 });
    expect(relianceOf({ cleansheet: 0.05, duel: 0.95 }, 2, norms)).toBeUndefined();
  });

  it("says nothing for a position with fewer than ten players to compare with", () => {
    expect(relianceOf({ cleansheet: 0.5 }, 1, norms)).toBeUndefined();
  });

  it("never calls a tiny share a dependency, even above the position's line", () => {
    const strikers: KbHistory = { ...emptyHistory(), season: "2026/2027" };
    for (let i = 0; i < 10; i++) strikers.players[`s${i}`] = { name: `S${i}`, team: "3", position: 4, games: [1, 2, 3, 4].map((d) => game(d, { 4231: 99, 4333: i === 9 ? 1 : 0 })) };
    expect(relianceOf({ cleansheet: 0.01, duel: 0.99 }, 4, relianceNorms(strikers))).toBeUndefined();
  });
});
