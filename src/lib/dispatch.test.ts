import { describe, it, expect } from "vitest";
import { dispatchScrape, WORKFLOW_DISPATCH_URL } from "./dispatch.ts";

describe("dispatchScrape", () => {
  it("starts the scrape workflow on main without forcing a deploy", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchFn = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;
    await dispatchScrape(fetchFn, "TOKEN");
    expect(calls[0].url).toBe(WORKFLOW_DISPATCH_URL);
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe("Bearer TOKEN");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ ref: "main", inputs: { force: "false" } });
  });

  it("throws with the status when GitHub refuses (e.g. expired token)", async () => {
    const fetchFn = (async () => new Response("Bad credentials", { status: 401 })) as unknown as typeof fetch;
    await expect(dispatchScrape(fetchFn, "OLD")).rejects.toThrow("401");
  });

  it("does nothing without a token", async () => {
    let called = false;
    const fetchFn = (async () => { called = true; return new Response(null, { status: 204 }); }) as unknown as typeof fetch;
    await dispatchScrape(fetchFn, undefined);
    expect(called).toBe(false);
  });
});
