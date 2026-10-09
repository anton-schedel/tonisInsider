import { describe, it, expect } from "vitest";
import { mergeOdds, oddsDue, oddsUrl, parseOdds, sameOdds, type OddsEvent } from "./odds.ts";

const book = (key: string, home: number, draw: number, away: number, h = "Borussia Dortmund", a = "Werder Bremen") => ({
  key, title: key, last_update: "2026-10-07T10:00:00Z",
  markets: [{ key: "h2h", outcomes: [{ name: h, price: home }, { name: a, price: away }, { name: "Draw", price: draw }] }],
});
const event = (bookmakers: unknown[], home = "Borussia Dortmund", away = "Werder Bremen") => ({
  id: "e1", sport_key: "soccer_germany_bundesliga", commence_time: "2026-10-09T18:30:00Z", home_team: home, away_team: away, bookmakers,
});

describe("parseOdds", () => {
  it("turns decimal odds into win/draw/loss chances without the bookmaker margin", () => {
    // 1/1.6 + 1/4.3 + 1/5.2 = 1.0499 → 59.5 % / 22.1 % / 18.3 %
    const [e] = parseOdds([event([book("pinnacle", 1.6, 4.3, 5.2)])]);
    expect(e).toEqual({ id: "e1", home: "Borussia Dortmund", away: "Werder Bremen", kickoff: "2026-10-09T18:30:00Z", chances: { home: 60, draw: 22, away: 18 }, books: 1 });
  });

  it("averages over all bookmakers", () => {
    const [e] = parseOdds([event([book("a", 2, 3.5, 4), book("b", 1.5, 4.5, 7)])]);
    expect(e.books).toBe(2);
    expect(e.chances.home + e.chances.draw + e.chances.away).toBe(100);
    expect(e.chances.home).toBeGreaterThan(50);
  });

  it("reads outcomes by team name, not by position", () => {
    const flipped = { ...book("a", 1.6, 4.3, 5.2), markets: [{ key: "h2h", outcomes: [{ name: "Draw", price: 4.3 }, { name: "Werder Bremen", price: 5.2 }, { name: "Borussia Dortmund", price: 1.6 }] }] };
    expect(parseOdds([event([flipped])])[0].chances).toEqual({ home: 60, draw: 22, away: 18 });
  });

  it("skips events without usable h2h odds and ignores broken bookmakers", () => {
    const broken = { key: "x", markets: [{ key: "h2h", outcomes: [{ name: "Borussia Dortmund", price: 0 }] }] };
    expect(parseOdds([event([]), event([broken])])).toEqual([]);
    expect(parseOdds([event([broken, book("a", 1.6, 4.3, 5.2)])])[0].books).toBe(1);
  });

  it("returns nothing for an unexpected response", () => {
    expect(parseOdds({ message: "quota" })).toEqual([]);
  });
});

describe("odds schedule", () => {
  const now = new Date("2026-10-07T12:00:00Z");
  it("fetches every 4 hours while a match is within 3 days, otherwise twice a day", () => {
    const soon = [{ kickoff: "2026-10-09T18:30:00Z" }]; // in 54.5 h
    const later = [{ kickoff: "2026-10-16T18:30:00Z" }];
    expect(oddsDue(undefined, now)).toBe(true);
    expect(oddsDue("2026-10-07T08:00:00Z", now, soon)).toBe(true);
    expect(oddsDue("2026-10-07T09:00:00Z", now, soon)).toBe(false);
    expect(oddsDue("2026-10-07T01:00:00Z", now, later)).toBe(false);
    expect(oddsDue("2026-10-07T00:00:00Z", now, later)).toBe(true);
  });

  it("builds the request for European bookmakers' 1X2 odds", () => {
    expect(oddsUrl("KEY")).toBe("https://api.the-odds-api.com/v4/sports/soccer_germany_bundesliga/odds/?apiKey=KEY&regions=eu&markets=h2h&oddsFormat=decimal");
  });
});

describe("sameOdds", () => {
  it("compares the shown percentages only", () => {
    const [a] = parseOdds([event([book("a", 1.6, 4.3, 5.2)])]);
    expect(sameOdds([a], [{ ...a, books: 7 }])).toBe(true);
    expect(sameOdds([a], [{ ...a, chances: { home: 61, draw: 21, away: 18 } }])).toBe(false);
    expect(sameOdds(undefined, [a])).toBe(false);
  });
});

describe("mergeOdds", () => {
  const ev = (home: string, kickoff: string, h = 50): OddsEvent => ({ home, away: "X", kickoff, chances: { home: h, draw: 25, away: 25 }, books: 5 });
  const now = new Date("2026-10-09T19:00:00Z");
  it("keeps the pre-match odds of a running match, even when the API drops it or sends live odds", () => {
    const old = [ev("BVB", "2026-10-09T18:30:00Z", 72), ev("FCA", "2026-10-10T13:30:00Z", 30)];
    expect(mergeOdds(old, [ev("FCA", "2026-10-10T13:30:00Z", 31)], now).map((e) => [e.home, e.chances.home])).toEqual([["BVB", 72], ["FCA", 31]]);
    expect(mergeOdds(old, [ev("BVB", "2026-10-09T18:30:00Z", 95)], now).map((e) => [e.home, e.chances.home])).toEqual([["BVB", 72]]);
  });
  it("forgets matches a day after kickoff", () => {
    expect(mergeOdds([ev("BVB", "2026-10-08T18:30:00Z")], [], now)).toEqual([]);
  });
});
