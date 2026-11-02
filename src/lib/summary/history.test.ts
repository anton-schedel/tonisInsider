import { describe, expect, it } from "vitest";
import { readKbHistory } from "./history.ts";
import { emptyHistory, HISTORY_VERSION } from "../../../scraper/kbHistory.ts";

const cache = () => ({}) as { entry?: { build: string; data: unknown } };
const asset = (status: number, body: unknown) => {
  const calls: string[] = [];
  const fetchAsset = async (path: string) => { calls.push(path); return new Response(JSON.stringify(body), { status }); };
  return { fetchAsset, calls };
};

describe("readKbHistory", () => {
  it("reads the site's history once per build", async () => {
    const c = cache();
    const { fetchAsset, calls } = asset(200, { ...emptyHistory(), season: "2026/2027" });
    expect((await readKbHistory(fetchAsset, "b1", c))?.season).toBe("2026/2027");
    await readKbHistory(fetchAsset, "b1", c);
    expect(calls).toEqual(["/data/kb-history.json"]);
  });

  it("is undefined without the file (a deploy before the first backfill) or from older code", async () => {
    expect(await readKbHistory(asset(404, {}).fetchAsset, "b1", cache())).toBeUndefined();
    expect(await readKbHistory(asset(200, { ...emptyHistory(), version: HISTORY_VERSION - 1 }).fetchAsset, "b1", cache())).toBeUndefined();
    expect(await readKbHistory(async () => { throw new Error("offline"); }, "b1", cache())).toBeUndefined();
  });
});
