import { describe, it, expect } from "vitest";
import { parseScorerOdds, scorerOddsUrl, scorersToFetch, pruneScorers, sameScorers } from "./scorers.ts";
import type { OddsEvent } from "./odds.ts";

const NOW = new Date("2026-10-08T12:00:00Z");
const ev = (id: string, kickoff: string): OddsEvent =>
  ({ id, home: "Borussia Dortmund", away: "Werder Bremen", kickoff, chances: { home: 60, draw: 22, away: 18 }, books: 5 });

describe("parseScorerOdds", () => {
  const yes = (description: string, price: number) => ({ name: "Yes", description, price });
  const body = {
    id: "e1", home_team: "Borussia Dortmund", away_team: "Werder Bremen", commence_time: "2026-10-09T18:30:00Z",
    bookmakers: [
      { key: "a", markets: [{ key: "player_goal_scorer_anytime", outcomes: [yes("Serhou Guirassy", 1.6), yes("Maximilian Beier", 2.5), { name: "No", description: "Serhou Guirassy", price: 2.2 }] }] },
      { key: "b", markets: [{ key: "player_goal_scorer_anytime", outcomes: [yes("Serhou Guirassy", 1.5), yes("Gregor Kobel", 0)] }] },
    ],
  };

  it("averages each player's implied chance to score over the bookmakers", () => {
    const m = parseScorerOdds(body, NOW);
    expect(m.home).toBe("Borussia Dortmund");
    expect(m.fetchedAt).toBe(NOW.toISOString());
    const g = m.players.find((p) => p.name === "Serhou Guirassy")!;
    expect(g.books).toBe(2);
    expect(g.p).toBeCloseTo((1 / 1.6 + 1 / 1.5) / 2, 4);
    expect(m.players.find((p) => p.name === "Maximilian Beier")?.books).toBe(1);
  });

  it("ignores 'No' outcomes and broken prices", () => {
    const m = parseScorerOdds(body, NOW);
    expect(m.players.map((p) => p.name).sort()).toEqual(["Maximilian Beier", "Serhou Guirassy"]);
  });

  it("copes with an empty response", () => {
    expect(parseScorerOdds({}, NOW).players).toEqual([]);
  });
});

describe("scorersToFetch", () => {
  it("fetches a match once it is within 40 hours, then again after a day (≈2 requests per match)", () => {
    const soon = ev("soon", "2026-10-09T18:30:00Z"); // in 30.5 h
    const later = ev("later", "2026-10-11T13:30:00Z"); // in 73.5 h
    const past = ev("past", "2026-10-08T10:00:00Z");
    expect(scorersToFetch([soon, later, past], {}, NOW)).toEqual(["soon"]);
    const fetched = { soon: { fetchedAt: "2026-10-08T00:00:00Z" } } as never;
    expect(scorersToFetch([soon], fetched, NOW)).toEqual([]);
    const yesterday = { soon: { fetchedAt: "2026-10-07T11:00:00Z" } } as never;
    expect(scorersToFetch([soon], yesterday, NOW)).toEqual(["soon"]);
  });
});

describe("pruneScorers", () => {
  it("forgets matches that ended", () => {
    const keep = { kickoff: "2026-10-09T18:30:00Z" } as never;
    const old = { kickoff: "2026-10-06T18:30:00Z" } as never;
    expect(Object.keys(pruneScorers({ keep, old }, NOW))).toEqual(["keep"]);
  });
});

describe("sameScorers", () => {
  it("compares rounded percentages only", () => {
    const a = { e1: { players: [{ name: "X", p: 0.501, books: 2 }] } } as never;
    const b = { e1: { players: [{ name: "X", p: 0.503, books: 3 }] } } as never;
    const c = { e1: { players: [{ name: "X", p: 0.52, books: 3 }] } } as never;
    expect(sameScorers(a, b)).toBe(true);
    expect(sameScorers(a, c)).toBe(false);
  });
});

it("asks US bookmakers for the anytime goalscorer market of one match", () => {
  expect(scorerOddsUrl("K", "e1")).toBe(
    "https://api.the-odds-api.com/v4/sports/soccer_germany_bundesliga/events/e1/odds/?apiKey=K&regions=us&markets=player_goal_scorer_anytime&oddsFormat=decimal",
  );
});
