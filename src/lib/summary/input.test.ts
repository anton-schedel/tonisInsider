import { describe, expect, it } from "vitest";
import { summaryInput } from "./input.ts";
import { emptyHistory, type HistGame, type KbHistory } from "../../../scraper/kbHistory.ts";
import type { Lineup } from "../../../scraper/types.ts";
import type { MyPlayer } from "../match.ts";

const lineup = (slug: string, name: string, kickoff: string, matchday: number, opponent: string, home: boolean): Lineup => ({
  club: { id: slug.length, slug, name }, opponent: { name: opponent, home }, matchday, kickoff, formation: "4-4-2", lines: [], updatedAt: kickoff,
});
const BVB = lineup("borussia-dortmund", "Borussia Dortmund", "2026-11-07T14:30:00Z", 9, "1. FC Union Berlin", false);
const UNION = lineup("1-fc-union-berlin", "1. FC Union Berlin", "2026-11-07T14:30:00Z", 9, "Borussia Dortmund", true);
const FRIDAY = lineup("sc-freiburg", "SC Freiburg", "2026-11-06T19:30:00Z", 9, "Hamburger SV", true);
// A club whose page still shows last weekend.
const STALE = lineup("fc-augsburg", "FC Augsburg", "2026-10-31T14:30:00Z", 8, "x", true);
const table = [{ id: "3", name: "Dortmund" }, { id: "40", name: "Union Berlin" }, { id: "5", name: "Freiburg" }];
const me = (id: string, l: Lineup | undefined, status: MyPlayer["status"] = "start"): MyPlayer =>
  ({ kickbase: { id, name: `Spieler ${id}`, teamId: "3", position: 3 }, lineup: l, club: l?.club, status }) as MyPlayer;

const args = (history: KbHistory | undefined) => ({
  now: new Date("2026-11-05T12:00:00Z"), players: [me("1", BVB), me("2", BVB, "bench")], history,
  lineups: [BVB, UNION, FRIDAY, STALE], predictions: [], cupGames: [], table,
});

describe("summaryInput", () => {
  it("adds his team's expected goals from the odds", () => {
    const odds = [{ home: "Union Berlin", away: "Borussia Dortmund", kickoff: "2026-11-07T14:30:00Z", chances: { home: 20, draw: 25, away: 55 }, books: 5 }];
    const a = { ...args(undefined), outlook: new Map([["1", { win: 55 }]]), odds };
    expect(summaryInput(a).players[0].outlook!.goals).toBeGreaterThan(1.3);
  });

  it("gives each player this week's game with short club names, his win and clean sheet chance and his position", () => {
    const a = { ...args(undefined), outlook: new Map([["1", { win: 74, cleanSheet: 41 }]]) };
    const [one, two] = summaryInput(a).players;
    // Dortmund is away at Union in this fixture list.
    expect(one.outlook).toEqual({ team: "Dortmund", opponent: "Union Berlin", home: false, win: 74, cleanSheet: 41, kickoff: "2026-11-07T14:30:00Z" });
    expect(one.position).toBe(3);
    expect(two.outlook).toBeUndefined();
  });

  it("says nothing about a game that has already started (a club whose page still shows last weekend)", () => {
    const h: KbHistory = { ...emptyHistory(), season: "2026/2027" };
    // Dortmund ("3") away at Union ("40"), which draws every home game (a weak home side), six times.
    const games: HistGame[] = [1, 2, 3, 4, 5, 6].map((d) => ({ day: d, matchId: `m${d}`, team: "3", minutes: 90, start: true, points: d < 4 ? 20 : 200, events: { 4216: 10 } }));
    h.players["1"] = { name: "Spieler 1", team: "3", position: 3, games };
    [1, 2, 3, 4, 5, 6].forEach((d) => { h.matches[`m${d}`] = { day: d, date: `2026-10-0${d}T13:30:00Z`, home: "40", away: "3", homeGoals: 1, awayGoals: 1 }; });
    expect(summaryInput(args(h)).players[0].matchup).toBeDefined();
    expect(summaryInput({ ...args(h), now: new Date("2026-11-07T15:00:00Z") }).players[0].matchup).toBeUndefined();
  });

  it("states no matchup when this week's opponent has fewer than 3 games to judge it by", () => {
    const h: KbHistory = { ...emptyHistory(), season: "2026/2027" };
    // Dortmund ("3") at home against "9" six times, away at Union ("40") never: Union has no games.
    const games: HistGame[] = [1, 2, 3, 4, 5, 6].map((d) => ({ day: d, matchId: `m${d}`, team: "3", minutes: 90, start: true, points: d < 4 ? 20 : 200, events: { 4216: 10 } }));
    h.players["1"] = { name: "Spieler 1", team: "3", position: 3, games };
    // "9" wins and loses at home in turn: an average team, so days 4–6 are "away against average teams" for him.
    [1, 2, 3, 4, 5, 6].forEach((d) => { h.matches[`m${d}`] = { day: d, date: `2026-10-0${d}T13:30:00Z`, home: "9", away: "3", homeGoals: d % 2 ? 1 : 0, awayGoals: d % 2 ? 0 : 1 }; });
    expect(summaryInput(args(h)).players[0].matchup).toBeUndefined();
  });

  it("works out the reliability once per history and predictions (both stay the same for a whole build)", () => {
    const h: KbHistory = { ...emptyHistory(), season: "2026/2027" };
    const a = { ...args(h), predictions: [] };
    expect(summaryInput(a).reliability).toBe(summaryInput({ ...a, now: new Date("2026-11-05T13:00:00Z") }).reliability);
  });

  it("takes the first kickoff of the matchday most clubs are on", () => {
    expect(summaryInput(args(undefined)).firstKickoff).toBe("2026-11-06T19:30:00Z");
  });

  it("works without the history: names and the predicted XI only", () => {
    const input = summaryInput(args(undefined));
    expect(input.players).toEqual([
      { name: "Spieler 1", inPredictedXi: true, position: 3, clubSlug: "borussia-dortmund", clubName: "Borussia Dortmund" },
      { name: "Spieler 2", inPredictedXi: false, position: 3, clubSlug: "borussia-dortmund", clubName: "Borussia Dortmund" },
    ]);
    expect(input.reliability.size).toBe(0);
  });

  it("leaves out what it can't know for a player without history (a new signing)", () => {
    const h: KbHistory = { ...emptyHistory(), season: "2026/2027" };
    const games: HistGame[] = [1, 2, 3, 4].map((d) => ({ day: d, matchId: `m${d}`, team: "3", minutes: 90, start: true, points: 100, events: { 4216: 10 } }));
    h.players["1"] = { name: "Spieler 1", team: "3", position: 3, games };
    [1, 2, 3, 4].forEach((d) => { h.matches[`m${d}`] = { day: d, date: `2026-10-0${d}T13:30:00Z`, home: "3", away: "40", homeGoals: 1, awayGoals: 0 }; });
    const [one, two] = summaryInput(args(h)).players;
    expect(one.profile?.games).toBe(4);
    expect(two.profile).toBeUndefined();
  });
});
