import { describe, expect, it } from "vitest";
import { headBox, personAlpha, sharpen } from "./teamAvatar.ts";

/** A w×h alpha array with the given rectangles solid (x0, y0, x1, y1; ends exclusive). */
function alpha(w: number, h: number, ...rects: [number, number, number, number][]) {
  const a = new Uint8Array(w * h);
  for (const [x0, y0, x1, y1] of rects) for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) a[y * w + x] = 255;
  return a;
}

describe("headBox", () => {
  it("frames like team-avatar.py: 70 % wide around the face, the hair 2 % below the top edge", () => {
    // 100×200: a head from x 40..60, top at row 30; shoulders much wider further down.
    const a = alpha(100, 200, [40, 30, 60, 70], [10, 70, 90, 200]);
    // Face rows 30+12 .. 30+28 → x 40..60, middle 50; side 70; y0 30 − 4.
    expect(headBox(a, 100, 200)).toEqual({ x0: 15, y0: 26, side: 70 });
  });
  it("follows a head off the middle, and ignores the faint edge (alpha ≤ 128)", () => {
    const a = alpha(100, 100, [60, 10, 80, 100]);
    a[5 * 100 + 5] = 128;
    expect(headBox(a, 100, 100)).toEqual({ x0: 35, y0: 8, side: 70 });
  });
  it("takes the whole subject when the face rows are empty (a very short cut-out)", () => {
    const a = alpha(100, 100, [20, 50, 40, 52]);
    expect(headBox(a, 100, 100)).toEqual({ x0: -5, y0: 48, side: 70 });
  });
  it("finds nothing without a person", () => {
    expect(headBox(new Uint8Array(100), 10, 10)).toBeUndefined();
  });
});

describe("personAlpha", () => {
  it("is 1 − background, with the faint halo cut (below 0.35 gone, from 0.75 solid)", () => {
    expect([...personAlpha([1, 0.7, 0.45, 0.25, 0])]).toEqual([0, 0, 128, 255, 255]);
  });
});

describe("sharpen", () => {
  it("leaves flat areas alone and lifts an edge", () => {
    const w = 5, h = 3;
    const px = new Uint8ClampedArray(w * h * 4).fill(100);
    for (let y = 0; y < h; y++) for (let x = 3; x < w; x++) px.fill(200, (y * w + x) * 4, (y * w + x) * 4 + 3);
    sharpen(px, w, h);
    expect(px[(1 * w + 1) * 4]).toBe(100);
    expect(px[(1 * w + 2) * 4]).toBeLessThan(100);
    expect(px[(1 * w + 3) * 4]).toBeGreaterThan(200 - 1);
  });
});
