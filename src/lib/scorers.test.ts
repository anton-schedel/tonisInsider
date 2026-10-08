import { describe, it, expect } from "vitest";
import { calibrate, findScorer, goalChances, matchInsights } from "./scorers.ts";
import type { ScorerMatch } from "../../scraper/scorers.ts";
import type { OddsEvent } from "../../scraper/odds.ts";
import type { Fixture } from "./fixtures.ts";

const ref = (name: string, slug: string) => ({ id: 1, name, slug });

describe("findScorer", () => {
  const names = ["Cardoso Romulo Jose", "Tiago Barreiros de Melo Tomas", "Luis Diaz", "Nico Schlotterbeck", "Felix Nmecha", "Serhou Guirassy", "Ermedin Demirovic"];
  it.each([
    [ref("Rômulo", "romulo"), "Cardoso Romulo Jose"],
    [ref("Tiago Tomás", "tiago-tomas"), "Tiago Barreiros de Melo Tomas"],
    [ref("Díaz", "luis-diaz"), "Luis Diaz"],
    [ref("N. Schlotterbeck", "nico-schlotterbeck"), "Nico Schlotterbeck"],
    [ref("F. Nmecha", "felix-nmecha"), "Felix Nmecha"],
    [ref("Guirassy", "serhou-guirassy"), "Serhou Guirassy"],
    [ref("Demirović", "ermedin-demirovic"), "Ermedin Demirovic"],
  ])("%o → %s", (r, expected) => expect(findScorer(r, names)).toBe(expected));

  it("doesn't guess between two players with the same surname", () => {
    expect(findScorer(ref("Nmecha", "nmecha"), ["Felix Nmecha", "Lukas Nmecha"])).toBeUndefined();
    expect(findScorer(ref("F. Nmecha", "felix-nmecha"), ["Felix Nmecha", "Lukas Nmecha"])).toBe("Felix Nmecha");
  });

  it("returns nothing for players the bookmakers don't list", () => {
    expect(findScorer(ref("Kobel", "gregor-kobel"), names)).toBeUndefined();
  });
});

describe("calibrate", () => {
  const players = [{ name: "A", p: 0.5, books: 2 }, { name: "B", p: 0.5, books: 2 }, { name: "Sub", p: 0.4, books: 2 }];

  it("scales the starters' expected goals to 85 % of the match goals (substitutes score the rest)", () => {
    // Starters A and B imply 2 × −ln(0.5) ≈ 1.386 goals; target 0.85 × 1.0 = 0.85 → each 0.425 xG ≈ 35 %.
    const chances = calibrate(players, 1.0, new Set(["A", "B"]));
    expect(chances.get("A")).toBeCloseTo(1 - Math.exp(-0.425), 3);
  });

  it("doesn't let bench players (bets void if they don't play) drag the starters down", () => {
    const withBench = calibrate(players, 2.0, new Set(["A", "B"]));
    expect(withBench.get("A")).toBeCloseTo(calibrate(players.slice(0, 2), 2.0, new Set(["A", "B"])).get("A")!, 6);
    expect(calibrate(players, 1.0, new Set(["A", "B"])).get("A")).toBeCloseTo(calibrate(players.slice(0, 2), 1.0, new Set(["A", "B"])).get("A")!, 6);
  });

  it("never raises a chance above the raw odds", () => {
    expect(calibrate(players, 9.0, new Set(["A", "B"])).get("A")).toBeCloseTo(0.5, 6);
  });

  it("without known starters, only removes a typical bookmaker margin", () => {
    expect(calibrate(players, 2.0).get("A")).toBeCloseTo(0.5 / 1.2, 3);
  });
});

describe("goalChances", () => {
  const lineup = (names: [string, string][]) => ({ lines: [names.map(([name, slug]) => ({ id: 1, name, slug, status: "set" }))] });
  const fixture = {
    homeName: "Borussia Dortmund", awayName: "SV Werder Bremen", kickoff: "2026-10-09T18:30:00Z",
    home: lineup([["Guirassy", "serhou-guirassy"], ["Beier", "maximilian-beier"]]),
    away: lineup([["Schmid", "romano-schmid"]]),
  } as unknown as Fixture;
  const odds: OddsEvent[] = [{ id: "e1", home: "Borussia Dortmund", away: "Werder Bremen", kickoff: "2026-10-09T18:30:00Z", chances: { home: 70, draw: 17, away: 13 }, books: 22 }];
  const match: ScorerMatch = {
    home: "Borussia Dortmund", away: "Werder Bremen", kickoff: "2026-10-09T18:30:00Z", fetchedAt: "x",
    players: [{ name: "Serhou Guirassy", p: 0.63, books: 4 }, { name: "Maximilian Beier", p: 0.38, books: 4 }, { name: "Romano Schmid", p: 0.25, books: 4 }],
  };

  it("gives each listed player a calibrated chance in whole percent", () => {
    const chance = goalChances(fixture, odds, { e1: match });
    const g = chance(ref("Guirassy", "serhou-guirassy"))!;
    expect(g).toBeGreaterThan(50);
    expect(g).toBeLessThanOrEqual(63); // never above the raw odds (they include the margin)
    expect(g).toBeLessThan(100);
    expect(chance(ref("Beier", "maximilian-beier"))!).toBeLessThan(g);
    expect(chance(ref("Kobel", "gregor-kobel"))).toBeUndefined();
  });

  it("returns nothing without goalscorer odds for the match", () => {
    expect(goalChances(fixture, odds, {})(ref("Guirassy", "serhou-guirassy"))).toBeUndefined();
    expect(goalChances(fixture, undefined, { e1: match })(ref("Guirassy", "serhou-guirassy"))).toBeUndefined();
  });
});

describe("matchInsights", () => {
  const lineup = (names: [string, string][]) => ({ lines: [names.map(([name, slug]) => ({ id: 1, name, slug, status: "set" }))] });
  const fixture = {
    homeName: "Borussia Dortmund", awayName: "SV Werder Bremen", kickoff: "2026-10-09T18:30:00Z",
    home: lineup([["Guirassy", "serhou-guirassy"], ["Beier", "maximilian-beier"], ["Can", "emre-can"]]),
    away: lineup([["Schmid", "romano-schmid"]]),
  } as unknown as Fixture;
  const odds: OddsEvent[] = [{ id: "e1", home: "Borussia Dortmund", away: "Werder Bremen", kickoff: "2026-10-09T18:30:00Z", chances: { home: 70, draw: 17, away: 13 }, books: 22 }];
  const full: ScorerMatch = {
    home: "Borussia Dortmund", away: "Werder Bremen", kickoff: "2026-10-09T18:30:00Z", fetchedAt: "x", fullAt: "x",
    players: [{ name: "Serhou Guirassy", p: 0.63, books: 4 }, { name: "Maximilian Beier", p: 0.38, books: 4 }, { name: "Romano Schmid", p: 0.25, books: 4 }],
    whGoal: [{ name: "Serhou Guirassy", p: 0.66, books: 1 }, { name: "Maximilian Beier", p: 0.4, books: 1 }, { name: "Romano Schmid", p: 0.27, books: 1 }],
    scoreOrAssist: [{ name: "Serhou Guirassy", p: 0.8, books: 1 }, { name: "Maximilian Beier", p: 0.6, books: 1 }, { name: "Romano Schmid", p: 0.5, books: 1 }],
    cards: [{ name: "Emre Can", p: 0.4, books: 1 }, { name: "Romano Schmid", p: 0.2, books: 1 }],
    cleanSheet: { "Borussia Dortmund": 0.38, "Werder Bremen": 0.11 },
  };
  const g = ref("Guirassy", "serhou-guirassy");

  it("gives goal, scorer (goal or assist) and card chances per player", () => {
    const i = matchInsights(fixture, odds, { e1: full })!;
    const p = i.player(g);
    expect(p.goal).toBe(goalChances(fixture, odds, { e1: full })(g));
    expect(p.scorer!).toBeGreaterThanOrEqual(p.goal!); // scoring or assisting is at least as likely as scoring
    expect(p.scorer!).toBeLessThanOrEqual(80); // never above the raw odds
    expect(i.player(ref("Can", "emre-can")).card!).toBeGreaterThan(i.player(ref("Schmid", "romano-schmid")).card!);
    expect(i.player(ref("Kobel", "gregor-kobel"))).toEqual({});
  });

  it("reads clean sheets from the team totals, turned to our home and away", () => {
    expect(matchInsights(fixture, odds, { e1: full })!.cleanSheet).toEqual({ home: 38, away: 11 });
    const swapped = { ...fixture, homeName: fixture.awayName, awayName: fixture.homeName, home: fixture.away, away: fixture.home } as Fixture;
    expect(matchInsights(swapped, odds, { e1: full })!.cleanSheet).toEqual({ home: 11, away: 38 });
  });

  it("falls back to the goal expectations behind the win chances for clean sheets", () => {
    const i = matchInsights(fixture, odds, {})!;
    // The favourite at home keeps a clean sheet more often than the outsider.
    expect(i.cleanSheet.home).toBeGreaterThan(i.cleanSheet.away);
    expect(i.player(g)).toEqual({});
  });

  it("returns nothing without odds for the match", () => {
    expect(matchInsights(fixture, undefined, { e1: full })).toBeUndefined();
  });
});
