import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { mergeScores, parseEspn, parseLiScores, parseLive } from "./live.ts";

const match = (over: object = {}) => ({
  matchDateTimeUTC: "2026-10-09T18:30:00Z",
  team1: { teamName: "Borussia Dortmund" },
  team2: { teamName: "SV Werder Bremen" },
  matchIsFinished: false,
  matchResults: [],
  goals: [],
  ...over,
});
const goal = (h: number, a: number, minute: number, name: string) =>
  ({ scoreTeam1: h, scoreTeam2: a, matchMinute: minute, goalGetterName: name, isPenalty: false, isOwnGoal: false });

describe("parseLive", () => {
  it("starts at 0:0 without goals", () => {
    expect(parseLive([match()])[0]).toMatchObject({ score: [0, 0], finished: false, goals: [], kickoff: "2026-10-09T18:30:00.000Z" });
  });

  it("takes the score from the latest goal", () => {
    const [m] = parseLive([match({ goals: [goal(1, 0, 12, "S. Guirassy"), goal(1, 1, 30, "J. Stage")] })]);
    expect(m.score).toEqual([1, 1]);
    expect(m.goals[1]).toEqual({ minute: 30, name: "J. Stage", home: 1, away: 1, penalty: false, own: false });
  });

  it("prefers the final result when goals are missing", () => {
    const results = [
      { resultOrderID: 1, pointsTeam1: 1, pointsTeam2: 0 },
      { resultOrderID: 2, pointsTeam1: 2, pointsTeam2: 0 },
    ];
    expect(parseLive([match({ matchIsFinished: true, matchResults: results, goals: [goal(1, 0, 12, "X")] })])[0].score).toEqual([2, 0]);
  });

  it("ignores anything that isn't a match list", () => {
    expect(parseLive({ error: 1 })).toEqual([]);
    expect(parseLive([{}])).toEqual([]);
  });
});

describe("parseLiScores", () => {
  const html = readFileSync(new URL("../../scraper/__fixtures__/home-matches.html", import.meta.url), "utf8");
  it("reads score and end of every game in the match bar", () => {
    const games = parseLiScores(html);
    expect(games.find((g) => g.home === "borussia-dortmund")).toEqual({ home: "borussia-dortmund", away: "sv-werder-bremen", score: [2, 2], finished: true });
    expect(games.find((g) => g.home === "sc-paderborn-07")).toEqual({ home: "sc-paderborn-07", away: "vfb-stuttgart", finished: false });
    expect(games.length).toBe(9);
  });
  it("is empty for other pages", () => {
    expect(parseLiScores("<html></html>")).toEqual([]);
  });
});

describe("parseEspn", () => {
  const clubs = [
    { name: "1. FC Union Berlin", slug: "1-fc-union-berlin" },
    { name: "SV 07 Elversberg", slug: "sv-07-elversberg" },
    { name: "FC Augsburg", slug: "fc-augsburg" },
    { name: "FC Bayern München", slug: "fc-bayern-muenchen" },
    { name: "RB Leipzig", slug: "rb-leipzig" },
    { name: "Eintracht Frankfurt", slug: "eintracht-frankfurt" },
  ];
  const team = (homeAway: string, displayName: string, score: string) => ({ homeAway, score, team: { displayName } });
  const event = (state: string, completed: boolean, home: [string, string], away: [string, string]) => ({
    date: "2026-10-10T13:30Z",
    status: { type: { state, completed } },
    competitions: [{ competitors: [team("home", ...home), team("away", ...away)] }],
  });
  it("maps ESPN's English names to our clubs, with the score once started", () => {
    const json = { events: [
      event("post", true, ["1. FC Union Berlin", "1"], ["SV Elversberg", "0"]),
      event("in", false, ["FC Augsburg", "2"], ["Bayern Munich", "2"]),
      event("pre", false, ["RB Leipzig", "0"], ["Eintracht Frankfurt", "0"]),
    ] };
    expect(parseEspn(json, clubs)).toEqual([
      { home: "1-fc-union-berlin", away: "sv-07-elversberg", score: [1, 0], finished: true },
      { home: "fc-augsburg", away: "fc-bayern-muenchen", score: [2, 2], finished: false },
      { home: "rb-leipzig", away: "eintracht-frankfurt", finished: false },
    ]);
  });
  it("prefers LigaInsider's game over ESPN's", () => {
    const li = [{ home: "a", away: "b", score: [1, 1] as [number, number], finished: false }];
    const espn = [{ home: "a", away: "b", score: [2, 1] as [number, number], finished: false }, { home: "c", away: "d", finished: false }];
    expect(mergeScores(li, espn)).toEqual([li[0], espn[1]]);
  });
});
