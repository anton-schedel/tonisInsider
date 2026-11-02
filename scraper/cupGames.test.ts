import { describe, expect, it } from "vitest";
import { cupGamesDue, mergeCupGames, parseCupGames } from "./cupGames.ts";

const event = (id: string, home: string, away: string, at = "2026-11-04T20:00:00Z") => ({ id, sport_key: "x", commence_time: at, home_team: home, away_team: away });
const BUNDESLIGA = new Set(["Borussia Dortmund", "Bayern Munich", "Union Berlin"]);

describe("parseCupGames", () => {
  it("keeps only games with a Bundesliga club, by the provider's exact name", () => {
    const json = [event("a", "Borussia Dortmund", "Real Betis"), event("b", "Celta Vigo", "Union Saint-Gilloise"), event("c", "Atlético Madrid", "Bayern Munich")];
    expect(parseCupGames(json, "Champions League", BUNDESLIGA)).toEqual([
      { id: "a", competition: "Champions League", kickoff: "2026-11-04T20:00:00Z", home: "Borussia Dortmund", away: "Real Betis" },
      { id: "c", competition: "Champions League", kickoff: "2026-11-04T20:00:00Z", home: "Atlético Madrid", away: "Bayern Munich" },
    ]);
  });

  it("is empty for an answer that isn't a list", () => {
    expect(parseCupGames({ message: "quota" }, "Champions League", BUNDESLIGA)).toEqual([]);
  });
});

describe("mergeCupGames", () => {
  it("keeps past games (the API only lists upcoming ones) and takes a moved kickoff", () => {
    const old = [{ id: "a", competition: "DFB-Pokal", kickoff: "2026-10-28T19:45:00Z", home: "x", away: "Union Berlin" }, { id: "b", competition: "Champions League", kickoff: "2026-11-04T20:00:00Z", home: "Borussia Dortmund", away: "y" }];
    const fresh = [{ id: "b", competition: "Champions League", kickoff: "2026-11-04T17:45:00Z", home: "Borussia Dortmund", away: "y" }];
    expect(mergeCupGames(old, fresh).map((g) => [g.id, g.kickoff])).toEqual([["a", "2026-10-28T19:45:00Z"], ["b", "2026-11-04T17:45:00Z"]]);
  });
});

describe("cupGamesDue", () => {
  it("is once a day", () => {
    const now = new Date("2026-11-02T12:00:00Z");
    expect(cupGamesDue(undefined, now)).toBe(true);
    expect(cupGamesDue("2026-11-01T12:30:00Z", now)).toBe(false);
    expect(cupGamesDue("2026-11-01T12:00:00Z", now)).toBe(true);
  });
});
