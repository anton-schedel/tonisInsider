import { describe, it, expect } from "vitest";
import { cleanSheets, euPropsUrl, matchdayRelease, parseFullOdds, parseScorerOdds, playerMarket, scorerOddsUrl, scorersToFetch, pruneScorers, sameScorers, usPropsUrl } from "./scorers.ts";
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
  const got = (fetchedAt: string, players = [{}], fullAt: string | null = fetchedAt) => ({ fetchedAt, fullAt: fullAt ?? undefined, players }) as never;
  const full = (id: string) => ({ id, full: true });
  const refresh = (id: string) => ({ id, full: false });

  it("fetches the whole matchday's full set together from Thursday 18:00, not before", () => {
    expect(scorersToFetch(all, {}, new Date("2026-10-08T15:55:00Z"))).toEqual([]);
    expect(scorersToFetch(all, {}, new Date("2026-10-08T16:00:00Z"))).toEqual([full("fri"), full("sun")]);
  });

  it("refreshes only the goalscorer odds within 6 h of kickoff, once", () => {
    const have = { fri: got("2026-10-08T16:00:00Z"), sun: got("2026-10-08T16:00:00Z") };
    expect(scorersToFetch(all, have, new Date("2026-10-09T10:00:00Z"))).toEqual([]);
    expect(scorersToFetch(all, have, new Date("2026-10-09T13:00:00Z"))).toEqual([refresh("fri")]);
    const refreshed = { ...have, fri: got("2026-10-09T13:00:00Z", [{}], "2026-10-08T16:00:00Z") };
    expect(scorersToFetch(all, refreshed, new Date("2026-10-09T14:00:00Z"))).toEqual([]);
  });

  it("does the full fetch once for matches stored before it existed", () => {
    const have = { fri: got("2026-10-08T16:00:00Z", [{}], null), sun: got("2026-10-08T16:00:00Z") };
    expect(scorersToFetch(all, have, new Date("2026-10-08T17:00:00Z"))).toEqual([full("fri")]);
  });

  it("retries the full set every 6 h while no bookmaker lists players", () => {
    const have = { fri: got("2026-10-08T16:00:00Z"), sun: got("2026-10-08T16:00:00Z", []) };
    expect(scorersToFetch(all, have, new Date("2026-10-08T20:00:00Z"))).toEqual([]);
    expect(scorersToFetch(all, have, new Date("2026-10-08T22:00:00Z"))).toEqual([full("sun")]);
  });

  it("skips matches that started", () => {
    const have = { sun: got("2026-10-08T16:00:00Z") };
    expect(scorersToFetch(all, have, new Date("2026-10-10T12:00:00Z"))).toEqual([]);
  });
});

describe("player and team markets", () => {
  const yes = (description: string, price: number) => ({ name: "Yes", description, price });
  const total = (name: string, description: string, price: number, point = 0.5) => ({ name, description, price, point });
  const us = {
    home_team: "Augsburg", away_team: "Bayern Munich", commence_time: "2026-10-10T13:30:00Z",
    bookmakers: [
      { key: "draftkings", markets: [
        { key: "player_goal_scorer_anytime", outcomes: [yes("Harry Kane", 1.4)] },
        { key: "alternate_team_totals", outcomes: [total("Over", "Augsburg", 1.4), total("Under", "Augsburg", 2.66), total("Under", "Augsburg", 1.1, 1.5)] },
        { key: "player_to_receive_card", outcomes: [yes("Jeffrey Gouweleeuw", 3.9)] },
      ] },
      // Only the under price for Bayern: one-sided, margin assumed.
      { key: "fanduel", markets: [{ key: "alternate_team_totals", outcomes: [total("Over", "Augsburg", 1.38), total("Under", "Augsburg", 2.92), total("Under", "Bayern Munich", 21)] }] },
    ],
  };
  const eu = {
    home_team: "Augsburg", away_team: "Bayern Munich",
    bookmakers: [{ key: "williamhill", markets: [
      { key: "player_goal_scorer_anytime", outcomes: [yes("Harry Kane", 1.3)] },
      { key: "player_to_score_or_assist", outcomes: [yes("Harry Kane", 1.15), yes("Michael Olise", 1.18)] },
    ] }],
  };

  it("reads one player market", () => {
    expect(playerMarket(us, "player_to_receive_card")).toEqual([{ name: "Jeffrey Gouweleeuw", p: 1 / 3.9, books: 1 }]);
    expect(playerMarket(eu, "player_to_score_or_assist").map((p) => p.name)).toEqual(["Harry Kane", "Michael Olise"]);
  });

  it("turns 'team under 0.5 goals' into the other team's clean sheet, margin removed", () => {
    const cs = cleanSheets(us);
    const dk = (1 / 2.66) / (1 / 2.66 + 1 / 1.4);
    const fd = (1 / 2.92) / (1 / 2.92 + 1 / 1.38);
    expect(cs["Bayern Munich"]).toBeCloseTo((dk + fd) / 2, 6);
    expect(cs["Augsburg"]).toBeCloseTo(1 / 21 / 1.05, 6);
    expect(cleanSheets({})).toEqual({});
  });

  it("combines the full fetch", () => {
    const m = parseFullOdds(us, eu, NOW);
    expect(m.fullAt).toBe(NOW.toISOString());
    expect(m.players.map((p) => p.name)).toEqual(["Harry Kane"]);
    expect(m.whGoal?.[0]).toMatchObject({ name: "Harry Kane", p: 1 / 1.3 });
    expect(m.scoreOrAssist).toHaveLength(2);
    expect(m.cards?.[0].name).toBe("Jeffrey Gouweleeuw");
    expect(Object.keys(m.cleanSheet ?? {}).sort()).toEqual(["Augsburg", "Bayern Munich"]);
  });

  it("asks for 3 US and 2 William Hill markets (≈5 credits per match)", () => {
    expect(usPropsUrl("K", "e1")).toContain("regions=us&markets=player_goal_scorer_anytime,alternate_team_totals,player_to_receive_card&");
    expect(euPropsUrl("K", "e1")).toContain("regions=eu&markets=player_goal_scorer_anytime,player_to_score_or_assist&");
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
  it("also notices changed clean sheets and cards", () => {
    const a = { e1: { players: [], cleanSheet: { Augsburg: 0.30 } } } as never;
    const b = { e1: { players: [], cleanSheet: { Augsburg: 0.34 } } } as never;
    expect(sameScorers(a, b)).toBe(false);
  });

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
