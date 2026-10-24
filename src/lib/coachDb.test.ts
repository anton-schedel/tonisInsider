import { describe, expect, it } from "vitest";
import { fromRow, pinnedUntil, type CoachRow } from "./coachDb.ts";

const row: CoachRow = {
  id: 900_001_003, type: "lineup", data: JSON.stringify({ headline: "Aufstellung", lineup: { lines: [["Coach"]], bench: [] } }),
  published_at: "2026-10-24T17:00:00.000Z", pinned_until: null, image_id: null, image_w: null, image_h: null,
  updated_at: "2026-10-24T12:00:00.000Z",
};

describe("coachDb", () => {
  it("reads a row into a post", () => {
    expect(fromRow(row)).toEqual({
      id: 900_001_003, type: "lineup", data: { headline: "Aufstellung", lineup: { lines: [["Coach"]], bench: [] } },
      publishedAt: "2026-10-24T17:00:00.000Z", updatedAt: "2026-10-24T12:00:00.000Z",
    });
    expect(fromRow({ ...row, pinned_until: "2026-10-24T18:00:00.000Z", image_id: "ab12cd34ef56ab78", image_w: 900, image_h: 1200 }))
      .toMatchObject({ pinnedUntil: "2026-10-24T18:00:00.000Z", image: { id: "ab12cd34ef56ab78", width: 900, height: 1200 } });
  });
  it("pins from the publish time", () => {
    expect(pinnedUntil("2026-10-24T17:00:00.000Z", 1.5)).toBe("2026-10-24T18:30:00.000Z");
    expect(pinnedUntil("2026-10-24T17:00:00.000Z", 0)).toBeNull();
  });
});
