import { describe, it, expect } from "vitest";
import { slotStyle } from "./pitch.ts";

const left = (style: string) => Number(/left:([\d.]+)%/.exec(style)![1]);

describe("slotStyle", () => {
  it("spreads a line evenly from left to right", () => {
    expect([0, 1, 2].map((j) => left(slotStyle(1, 4, j, 3)))).toEqual([25, 50, 75]);
  });

  it("mirrors LigaInsider's order: they draw the goalkeeper at the top, we at the bottom", () => {
    // LigaInsider lists BVB's back three as Gadou (right CB), Anton, Schlotterbeck (left CB).
    const [gadou, anton, schlotterbeck] = [0, 1, 2].map((j) => left(slotStyle(1, 4, j, 3, { mirror: true })));
    expect(gadou).toBe(75);
    expect(anton).toBe(50);
    expect(schlotterbeck).toBe(25);
  });
});
