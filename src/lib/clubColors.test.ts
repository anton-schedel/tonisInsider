import { describe, expect, it } from "vitest";
import { clubColor, matchTint } from "./clubColors.ts";

describe("club colours", () => {
  it("knows all clubs by slug", () => {
    expect(clubColor("borussia-dortmund")).toBe("#fde100");
    expect(clubColor("unknown")).toBeUndefined();
    expect(clubColor(undefined)).toBeUndefined();
  });

  it("tints each side of a match card with its club colour", () => {
    const bg = matchTint("borussia-dortmund", "sv-werder-bremen")!;
    expect(bg).toContain("color-mix(in srgb, #fde100 var(--tint), var(--surface)) 0%");
    expect(bg).toContain("color-mix(in srgb, #1d9053 var(--tint), var(--surface)) 100%");
    expect(matchTint("unknown", undefined)).toBeUndefined();
  });
});
