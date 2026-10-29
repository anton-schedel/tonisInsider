import { describe, expect, it } from "vitest";
import { defaultCrop, fit } from "./coachCrop.ts";

describe("defaultCrop", () => {
  it("frames a tall photo near its top (the head), a wide one in the middle", () => {
    // 454×982: the circle is the photo's width, its top 8 % down.
    const tall = defaultCrop(454, 982);
    expect(tall.x).toBe(0.5);
    expect(tall.y * 982 - 454 / 2).toBeCloseTo(0.08 * 982);
    expect(defaultCrop(1200, 800)).toEqual({ x: 0.5, y: 0.5, zoom: 1 });
  });
  it("never lets the circle leave the photo", () => {
    expect(fit(1000, 1000, { x: 0, y: 1, zoom: 2 })).toEqual({ x: 0.25, y: 0.75, zoom: 2 });
    expect(fit(1000, 1000, { x: 0.9, y: 0.1, zoom: 9 })).toEqual({ x: 0.875, y: 0.125, zoom: 4 });
  });
});
