import { describe, expect, it } from "vitest";
import { contextOf, matchupIndex, profileOf, type Profile } from "./profile.ts";
import type { HistGame, HistMatch, HistPlayer } from "../../../scraper/kbHistory.ts";

const date = (day: number) => `2026-09-${String(day).padStart(2, "0")}T13:30:00Z`;
/** Matches of day 1–n: team "10" at home against "3" on odd days, away at "3" on even days. */
const matchesOf = (n: number, home = "10"): Record<string, HistMatch> => Object.fromEntries(
  Array.from({ length: n }, (_, i) => i + 1).map((d) => [`m${d}`, d % 2 ? { day: d, date: date(d), home, away: "3", homeGoals: 1, awayGoals: 1 } : { day: d, date: date(d), home: "3", away: home, homeGoals: 1, awayGoals: 1 }]),
);
const game = (day: number, extra: Partial<HistGame> = {}): HistGame => ({
  day, matchId: `m${day}`, team: "10", minutes: 90, start: true, points: 100, events: { 4216: 12, 4231: 5 }, ...extra,
});
const player = (games: HistGame[]): HistPlayer => ({ name: "Saibari", team: "10", position: 4, games });

describe("profileOf", () => {
  it("needs four games with minutes", () => {
    expect(profileOf(player([game(1), game(2), game(3), game(4, { minutes: 0 })]), matchesOf(4))).toBeUndefined();
  });

  it("knows where his points come from", () => {
    const p = profileOf(player([1, 2, 3, 4].map((d) => game(d))), matchesOf(4))!;
    expect(p.top).toBe("attack");
    expect(p.shares.attack).toBeCloseTo(12 / 17);
    expect(p.avg).toBeCloseTo(100);
  });

  it("never names \"other\" as where his points come from", () => {
    const p = profileOf(player([1, 2, 3, 4].map((d) => game(d, { events: { 999999: 50, 4231: 5 } }))), matchesOf(4))!;
    expect(p.top).toBe("duel");
  });

  it("leaves negative points out of the shares, which add up to one", () => {
    const p = profileOf(player([1, 2, 3, 4].map((d) => game(d, { events: { 4216: 12, 4231: 5, 4240: -1 } }))), matchesOf(4))!;
    expect(Object.values(p.shares).reduce((a, b) => a + b!, 0)).toBeCloseTo(1);
    expect(p.shares.mistake).toBeUndefined();
  });

  it("leaves games against an opponent with fewer than 3 games then out of the kinds of match (its form says nothing yet)", () => {
    // Opponent "3" has 0, 1, 2 and 3 earlier games on days 1–4.
    const p = profileOf(player([1, 2, 3, 4].map((d) => game(d))), matchesOf(4))!;
    expect(p.byContext.reduce((n, b) => n + b.games, 0)).toBe(1);
    expect(p.games).toBe(4);
  });

  it("takes home and away from the club he played for then, not his current one", () => {
    const matches = { ...matchesOf(6) };
    // Days 1 and 2 he still played for "7": day 1 "7" at home, day 2 away.
    matches.m1 = { day: 1, date: date(1), home: "7", away: "3", homeGoals: 1, awayGoals: 0 };
    matches.m2 = { day: 2, date: date(2), home: "3", away: "7", homeGoals: 1, awayGoals: 0 };
    const p = profileOf(player([game(1, { team: "7", points: 40 }), game(2, { team: "7" }), game(3), game(4), game(5), game(6)]), matches)!;
    // Only the games where the opponent already had 3 games count: days 4 to 6, of which day 5 at home ("10").
    const home = p.byContext.filter((b) => b.context.home);
    expect(home.reduce((n, b) => n + b.games, 0)).toBe(1);
  });
});

describe("contextOf", () => {
  it("is the opponent's strength at its venue then", () => {
    const form = { games: 5, ppg: 1.4, homePpg: 2.2, awayPpg: 0.8, momentum: 7, last: 5 };
    expect(contextOf(form, true)).toBe("strong");
    expect(contextOf(form, false)).toBe("weak");
    expect(contextOf({ ...form, homePpg: 1.4 }, true)).toBe("middle");
    expect(contextOf(undefined, true)).toBe("middle");
  });
});

describe("matchupIndex", () => {
  const profile: Profile = {
    games: 6, avg: 100, shares: { attack: 1 }, top: "attack",
    byContext: [
      { context: { home: true, opponent: "strong" }, avg: 50, games: 2 },
      { context: { home: false, opponent: "weak" }, avg: 160, games: 1 },
    ],
  };
  it("compares how he does in this kind of match with his average, pulled toward it the fewer such games there are", () => {
    // Six games at 20 against his 100, plus three "games" at his average: (6·20 + 3·100) / 9.
    const many = { ...profile, byContext: [{ context: { home: true, opponent: "strong" as const }, avg: 20, games: 6 }] };
    expect(matchupIndex(many, { home: true, opponent: "strong" })!.index).toBeCloseTo(420 / 9 / 100);
    expect(matchupIndex(many, { home: true, opponent: "strong" })!.games).toBe(6);
  });
  it("says nothing from two games or fewer", () => {
    expect(matchupIndex(profile, { home: true, opponent: "strong" })).toBeUndefined();
    expect(matchupIndex(profile, { home: false, opponent: "weak" })).toBeUndefined();
    expect(matchupIndex(profile, { home: false, opponent: "middle" })).toBeUndefined();
  });
});
