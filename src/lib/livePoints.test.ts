import { describe, expect, it } from "vitest";
import { actionTier, anyRunning, pointsLabel, pointsTier, summarize } from "./livePoints.ts";

describe("pointsLabel", () => {
  it("shows nothing before kickoff", () => {
    expect(pointsLabel({ state: 0, kickoff: "2026-10-18T13:30:00Z" })).toBeUndefined();
    expect(pointsLabel(undefined)).toBeUndefined();
  });
  it("shows live and final points", () => {
    expect(pointsLabel({ state: 1, points: 31, minute: 63 })).toEqual({ text: "31", live: true, negative: false, tier: "pts-low" });
    expect(pointsLabel({ state: 2, points: -10 })).toEqual({ text: "-10", live: false, negative: true, tier: "pts-neg" });
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

describe("summarize", () => {
  const names = new Map([[4201, "Pass vorderes Drittel"], [4240, "Ballverlust"], [4234, "Gelbe Karte"], [-10, "Erste Halbzeit beendet"]]);
  it("groups actions by kind, biggest effect first, and leaves out those worth nothing", () => {
    const events = [
      { type: 4201, points: 2, minute: 5 }, { type: 4240, points: -1, minute: 9 }, { type: 4201, points: 2, minute: 30 },
      { type: 4234, points: -10, minute: 44 }, { type: -10, points: 0, minute: 45 }, { type: 4999, points: 3, minute: 60 },
    ];
    expect(summarize(events, names)).toEqual([
      { name: "Gelbe Karte", count: 1, points: -10 },
      { name: "Pass vorderes Drittel", count: 2, points: 4 },
      { name: "Sonstiges", count: 1, points: 3 },
      { name: "Ballverlust", count: 1, points: -1 },
    ]);
  });
});

describe("pointsTier", () => {
  it("red below 0, orange to 99, light green to 199, darker green to 399, gold from 400", () => {
    expect([-1, 0, 1, 99, 100, 199, 200, 399, 400, 525].map((p) => pointsTier(p))).toEqual([
      "pts-neg", "pts-low", "pts-low", "pts-low", "pts-mid", "pts-mid", "pts-high", "pts-high", "pts-gold", "pts-gold",
    ]);
    expect(pointsTier(undefined)).toBeUndefined();
  });
  it("colours single actions: minus red, plus light green, big ones darker green", () => {
    expect([1, 80, -1].map(actionTier)).toEqual(["pts-mid", "pts-high", "pts-neg"]);
  });
});
