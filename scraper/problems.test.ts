import { describe, expect, it } from "vitest";
import { lastingProblems, RUNS_BETWEEN_REMINDERS } from "./problems.ts";

describe("lastingProblems", () => {
  const lineup = (n: number) => `lineup eintracht-frankfurt: expected 11 players, got ${n}`;

  it("reports a problem only on its third run in a row", () => {
    let s = lastingProblems([lineup(10)], {});
    expect(s.report).toEqual([]);
    s = lastingProblems([lineup(9)], s.streaks);
    expect(s.report).toEqual([]);
    s = lastingProblems([lineup(10)], s.streaks);
    expect(s.report).toEqual([lineup(10)]);
  });

  it("reports a lasting problem once, then once a day", () => {
    let s = { report: [] as string[], streaks: {} as Record<string, number> };
    const reported: number[] = [];
    for (let run = 1; run <= 3 + 2 * RUNS_BETWEEN_REMINDERS; run++) {
      s = lastingProblems([lineup(0)], s.streaks);
      if (s.report.length) reported.push(run);
    }
    expect(reported).toEqual([3, 3 + RUNS_BETWEEN_REMINDERS, 3 + 2 * RUNS_BETWEEN_REMINDERS]);
  });

  it("treats a failed article download (LigaInsider's HTTP 500) like any glitch", () => {
    const p = "download article 419298: HTTP 500 for https://www.ligainsider.de/x-419298/";
    let s = lastingProblems([p], {});
    expect(s.report).toEqual([]);
    s = lastingProblems([p], s.streaks);
    expect(lastingProblems([p], s.streaks).report).toEqual([p]);
  });

  it("starts over once a run is fine again", () => {
    let s = lastingProblems(["clubs: expected 18, got 0"], {});
    s = lastingProblems(["clubs: expected 18, got 0"], s.streaks);
    s = lastingProblems([], s.streaks);
    expect(s.streaks).toEqual({});
    expect(lastingProblems(["clubs: expected 18, got 0"], s.streaks).report).toEqual([]);
  });

  it("reports article problems at once (they are reported a single time, then skipped)", () => {
    expect(lastingProblems(["article 418731: no body"], {}).report).toEqual(["article 418731: no body"]);
  });
});
