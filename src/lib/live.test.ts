import { describe, expect, it } from "vitest";
import { parseLive } from "./live.ts";

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
