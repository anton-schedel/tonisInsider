import { describe, it, expect } from "vitest";
import { updateAction } from "./freshness.ts";

const page = { newest: 5, updated: "2026-10-07T12:00:00Z" };
const ctx = { resumed: false, nearTop: false, path: "/" };

describe("updateAction", () => {
  it("does nothing while the page is current", () => {
    expect(updateAction(page, { ...page }, ctx)).toBe("none");
  });

  it("offers new news with a notice instead of moving content under your finger", () => {
    expect(updateAction(page, { newest: 6, updated: "2026-10-07T12:05:00Z" }, ctx)).toBe("notice");
    expect(updateAction(page, { newest: 6, updated: "x" }, { ...ctx, resumed: true, nearTop: false })).toBe("notice");
  });

  it("refreshes quietly when you come back to the app and are at the top", () => {
    expect(updateAction(page, { newest: 6, updated: "x" }, { ...ctx, resumed: true, nearTop: true })).toBe("refresh");
    // Lineups or odds changed (no new article): same.
    expect(updateAction(page, { newest: 5, updated: "x" }, { ...ctx, resumed: true, nearTop: true })).toBe("refresh");
  });

  it("ignores other updates while you are reading", () => {
    expect(updateAction(page, { newest: 5, updated: "x" }, ctx)).toBe("none");
  });

  it("never reloads Mein Team by itself (it asks Kickbase), but still shows the notice", () => {
    const mine = { ...ctx, path: "/mein-team/", resumed: true, nearTop: true };
    expect(updateAction(page, { newest: 5, updated: "x" }, mine)).toBe("none");
    expect(updateAction(page, { newest: 6, updated: "x" }, mine)).toBe("notice");
  });

  it("does nothing if either version is unknown", () => {
    expect(updateAction({}, { newest: 6, updated: "x" }, { ...ctx, resumed: true, nearTop: true })).toBe("none");
    expect(updateAction(page, {}, ctx)).toBe("none");
  });
});
