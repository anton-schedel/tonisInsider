import { describe, it, expect } from "vitest";
import { pinnedIds } from "./pinned.ts";

const at = (id: number, publishedAt: string) => ({ id, publishedAt });

describe("pinnedIds", () => {
  it("finds the articles LigaInsider puts on top although newer ones follow", () => {
    const listed = [1, 2, 3, 4];
    const known = [at(1, "2026-10-06T18:00:00Z"), at(2, "2026-10-08T09:00:00Z"), at(3, "2026-10-08T08:00:00Z"), at(4, "2026-10-08T07:00:00Z")];
    expect(pinnedIds(listed, known)).toEqual([1]);
  });

  it("handles several pinned articles and stops at the first chronological one", () => {
    const listed = [7, 8, 2, 3, 9];
    const known = [
      at(7, "2026-10-05T10:00:00Z"), at(8, "2026-10-06T18:00:00Z"),
      at(2, "2026-10-08T09:00:00Z"), at(3, "2026-10-08T08:00:00Z"), at(9, "2026-10-07T08:00:00Z"),
    ];
    expect(pinnedIds(listed, known)).toEqual([7, 8]);
  });

  it("pins nothing when the list is in time order", () => {
    expect(pinnedIds([2, 3], [at(2, "2026-10-08T09:00:00Z"), at(3, "2026-10-08T08:00:00Z")])).toEqual([]);
  });

  it("ignores articles it doesn't know yet", () => {
    expect(pinnedIds([5, 2, 3], [at(2, "2026-10-08T09:00:00Z"), at(3, "2026-10-08T08:00:00Z")])).toEqual([]);
  });
});
