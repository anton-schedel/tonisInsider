import { describe, expect, it } from "vitest";
import { formBefore, venuePpg } from "./teamForm.ts";
import type { HistMatch } from "../../../scraper/kbHistory.ts";

// Team "2", oldest first: W at home, L away, D at home, W away.
const matches: Record<string, HistMatch> = {
  a: { day: 1, date: "2026-08-28T18:30:00Z", home: "2", away: "9", homeGoals: 5, awayGoals: 1 },
  b: { day: 2, date: "2026-09-05T13:30:00Z", home: "8", away: "2", homeGoals: 1, awayGoals: 0 },
  c: { day: 3, date: "2026-09-13T13:30:00Z", home: "2", away: "7", homeGoals: 2, awayGoals: 2 },
  d: { day: 4, date: "2026-09-20T13:30:00Z", home: "5", away: "2", homeGoals: 0, awayGoals: 3 },
  // Not played yet: no goals.
  e: { day: 5, date: "2026-09-27T13:30:00Z", home: "2", away: "4" },
};

describe("formBefore", () => {
  it("weighs recent games more and keeps the plain points of the last five as momentum", () => {
    const f = formBefore(matches, "2", "2099-01-01T00:00:00Z")!;
    expect(f.games).toBe(4);
    expect(f.momentum).toBe(7);
    expect(f.last).toBe(4);
    // Newest first: 3, 1, 0, 3 with weights 1, 0.85, 0.7225, 0.614125.
    expect(f.ppg).toBeCloseTo(1.786, 3);
    // Home games only, newest first: D (1), W (0.85).
    expect(f.homePpg).toBeCloseTo(1.919, 3);
    expect(f.awayPpg).toBeCloseTo(3 / 1.85, 3);
  });

  it("counts only matches before the date", () => {
    expect(formBefore(matches, "2", "2026-09-13T13:30:00Z")!.games).toBe(2);
  });

  it("is undefined for a team without games", () => {
    expect(formBefore(matches, "99", "2099-01-01T00:00:00Z")).toBeUndefined();
  });
});

describe("venuePpg", () => {
  it("is the home or away strength, else the overall one", () => {
    const f = formBefore(matches, "2", "2026-09-06T00:00:00Z")!;
    expect(venuePpg(f, true)).toBe(3);
    expect(venuePpg(f, false)).toBe(0);
    expect(venuePpg({ ...f, awayPpg: undefined }, false)).toBe(f.ppg);
  });
});
