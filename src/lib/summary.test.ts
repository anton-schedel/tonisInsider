import { describe, expect, it } from "vitest";
import { teamSummary } from "./summary.ts";
import type { MyPlayer, StartStatus } from "./match.ts";

const player = (id: string, status: StartStatus) => ({ kickbase: { id }, status }) as unknown as MyPlayer;

describe("teamSummary", () => {
  const xi = [
    player("1", "start"), player("2", "start"), player("3", "contested"), player("4", "doubtful"),
    player("5", "alternative"), player("6", "bench"), player("7", "unknown"),
  ];

  it("counts who is in the predicted XI, who wobbles and who is out", () => {
    const s = teamSummary(xi, new Map());
    expect(s).toMatchObject({ starting: 4, shaky: 2, out: 2, unknown: 1, total: 7 });
    expect(s.statuses).toEqual(["start", "start", "contested", "doubtful", "alternative", "bench", "unknown"]);
    expect(s.scorers).toBeUndefined();
  });

  it("adds up the goal chances to the expected number of scorers", () => {
    expect(teamSummary(xi, new Map([["1", 45], ["3", 30], ["4", 12]])).scorers).toBe(0.87);
  });
});
