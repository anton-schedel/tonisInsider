import { describe, expect, it } from "vitest";
import { anyRunning, pointsLabel } from "./livePoints.ts";

describe("pointsLabel", () => {
  it("shows nothing before kickoff", () => {
    expect(pointsLabel({ state: 0, kickoff: "2026-10-18T13:30:00Z" })).toBeUndefined();
    expect(pointsLabel(undefined)).toBeUndefined();
  });
  it("shows live and final points", () => {
    expect(pointsLabel({ state: 1, points: 31, minute: 63 })).toEqual({ text: "31", live: true, negative: false });
    expect(pointsLabel({ state: 2, points: -10 })).toEqual({ text: "-10", live: false, negative: true });
  });
  it("0 while running without points, – after a match he didn't play", () => {
    expect(pointsLabel({ state: 1 })?.text).toBe("0");
    expect(pointsLabel({ state: 2 })?.text).toBe("–");
  });
});

describe("anyRunning", () => {
  const now = Date.parse("2026-10-17T14:00:00Z");
  it("is true while a match runs, or once its kickoff passed but Kickbase hasn't started it yet", () => {
    expect(anyRunning([{ state: 2 }, { state: 1 }], now)).toBe(true);
    expect(anyRunning([{ state: 0, kickoff: "2026-10-17T13:30:00Z" }], now)).toBe(true);
  });
  it("is false when all are over or yet to come", () => {
    expect(anyRunning([{ state: 2 }, { state: 0, kickoff: "2026-10-18T13:30:00Z" }, undefined], now)).toBe(false);
  });
});
