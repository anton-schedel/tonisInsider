import { describe, it, expect } from "vitest";
import { updateAction } from "./freshness.ts";

const page = { newest: 5, updated: "2026-10-07T12:00:00Z" };
const ctx = { resumed: false, nearTop: false, path: "/" };

describe("updateAction", () => {
  const back = { ...ctx, resumed: true, nearTop: true };
  const mine = { ...back, path: "/mein-team/" };
  it.each([
    ["nothing while the page is current", page, page, ctx, "none"],
    ["a notice for new news instead of moving content under your finger", page, { newest: 6, updated: "2026-10-07T12:05:00Z" }, ctx, "notice"],
    ["a notice for new news when you come back away from the top", page, { newest: 6, updated: "x" }, { ...ctx, resumed: true }, "notice"],
    ["a quiet refresh when you come back at the top", page, { newest: 6, updated: "x" }, back, "refresh"],
    ["a quiet refresh for changed lineups or odds when you come back at the top", page, { newest: 5, updated: "x" }, back, "refresh"],
    ["nothing for other updates while you are reading", page, { newest: 5, updated: "x" }, ctx, "none"],
    ["no reload of Mein Team by itself (it asks Kickbase)", page, { newest: 5, updated: "x" }, mine, "none"],
    ["still the notice on Mein Team", page, { newest: 6, updated: "x" }, mine, "notice"],
    ["nothing if the page's version is unknown", {}, { newest: 6, updated: "x" }, back, "none"],
    ["nothing if the new version is unknown", page, {}, ctx, "none"],
  ])("gives %s", (_, now, next, c, expected) => {
    expect(updateAction(now, next, c)).toBe(expected);
  });
});

describe("newestOut", () => {
  it("is the newest article that is already out", async () => {
    const { newestOut } = await import("./freshness.ts");
    const now = new Date("2026-10-24T12:00:00.000Z");
    expect(newestOut([{ id: 9, publishedAt: "2026-10-24T12:05:00.000Z" }, { id: 7, publishedAt: "2026-10-24T11:00:00.000Z" }], now)).toBe(7);
    expect(newestOut([], now)).toBeUndefined();
  });
});
