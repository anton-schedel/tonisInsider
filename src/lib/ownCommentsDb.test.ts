import { describe, expect, it } from "vitest";
import type { D1 } from "cloudflare:workers";
import { commentTotals } from "./ownCommentsDb.ts";

describe("commentTotals", () => {
  it("counts the comments that are out per post, 0 for posts without", async () => {
    let bound: unknown[] = [];
    const db = {
      prepare: () => ({
        bind: (...values: unknown[]) => {
          bound = values;
          return { all: async () => ({ results: [{ post_id: 900001001, n: 4 }] }) };
        },
      }),
    } as unknown as D1;
    const now = new Date("2026-10-27T12:00:00Z");
    expect(await commentTotals(db, [900001001, 900001002], now)).toEqual({ 900001001: 4, 900001002: 0 });
    expect(bound).toEqual([900001001, 900001002, now.toISOString()]);
  });
});
