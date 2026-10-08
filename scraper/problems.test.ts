import { describe, expect, it } from "vitest";
import { lastingProblems } from "./problems.ts";

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
