import { describe, it, expect } from "vitest";
import { oddsDue, oddsUrl, parseOdds, sameOdds } from "./odds.ts";

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
    expect(e).toEqual({ home: "Borussia Dortmund", away: "Werder Bremen", kickoff: "2026-10-09T18:30:00Z", chances: { home: 60, draw: 22, away: 18 }, books: 1 });
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
  it("fetches every 2 hours (≈360 of the 500 free requests a month)", () => {
    expect(oddsDue(undefined, now)).toBe(true);
    expect(oddsDue("2026-10-07T10:00:00Z", now)).toBe(true);
    expect(oddsDue("2026-10-07T10:30:00Z", now)).toBe(false);
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
