import { describe, it, expect } from "vitest";
import { matchdayRelease, parseScorerOdds, scorerOddsUrl, scorersToFetch, pruneScorers, sameScorers } from "./scorers.ts";
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

describe("matchdayRelease", () => {
  it("is Thursday 18:00 Berlin time before the matchday", () => {
    expect(matchdayRelease(new Date("2026-10-09T18:30:00Z")).toISOString()).toBe("2026-10-08T16:00:00.000Z"); // summer time
    expect(matchdayRelease(new Date("2026-11-21T14:30:00Z")).toISOString()).toBe("2026-11-19T17:00:00.000Z"); // winter time
  });

  it("is at least a day before the first kickoff", () => {
    expect(matchdayRelease(new Date("2026-10-08T18:30:00Z")).toISOString()).toBe("2026-10-07T18:30:00.000Z");
  });
});

describe("scorersToFetch", () => {
  // Friday 20:30 to Sunday 17:30, then the next matchday a week later.
  const fri = ev("fri", "2026-10-09T18:30:00Z");
  const sun = ev("sun", "2026-10-11T15:30:00Z");
  const next = ev("next", "2026-10-16T18:30:00Z");
  const all = [next, sun, fri];
  const got = (fetchedAt: string, players = [{}]) => ({ fetchedAt, players }) as never;

  it("fetches the whole matchday together from Thursday 18:00, not before", () => {
    expect(scorersToFetch(all, {}, new Date("2026-10-08T15:55:00Z"))).toEqual([]);
    expect(scorersToFetch(all, {}, new Date("2026-10-08T16:00:00Z"))).toEqual(["fri", "sun"]);
  });

  it("fetches each match once more within 6 h of kickoff", () => {
    const have = { fri: got("2026-10-08T16:00:00Z"), sun: got("2026-10-08T16:00:00Z") };
    expect(scorersToFetch(all, have, new Date("2026-10-09T10:00:00Z"))).toEqual([]);
    expect(scorersToFetch(all, have, new Date("2026-10-09T13:00:00Z"))).toEqual(["fri"]);
    const refreshed = { ...have, fri: got("2026-10-09T13:00:00Z") };
    expect(scorersToFetch(all, refreshed, new Date("2026-10-09T14:00:00Z"))).toEqual([]);
  });

  it("retries every 6 h while no bookmaker lists players", () => {
    const have = { fri: got("2026-10-08T16:00:00Z"), sun: got("2026-10-08T16:00:00Z", []) };
    expect(scorersToFetch(all, have, new Date("2026-10-08T20:00:00Z"))).toEqual([]);
    expect(scorersToFetch(all, have, new Date("2026-10-08T22:00:00Z"))).toEqual(["sun"]);
  });

  it("skips matches that started", () => {
    const have = { sun: got("2026-10-08T16:00:00Z") };
    expect(scorersToFetch(all, have, new Date("2026-10-10T12:00:00Z"))).toEqual([]);
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
