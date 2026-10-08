import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bannerKey, ensureImage } from "./images.ts";
import type { Fetcher } from "./fetch.ts";

function fetcher(fail = false) {
  const calls: string[] = [];
  const f: Fetcher = {
    async text() { throw new Error("unused"); },
    async binary(url) {
      calls.push(url);
      if (fail) throw new Error("HTTP 500");
      return new Uint8Array([7, 7]);
    },
  };
  return { f, calls };
}

describe("bannerKey", () => {
  it("names a banner by its photo file, so articles sharing a photo share one download", () => {
    const u = (credit: string) => `https://cdn.ligainsider.com/ligainsider//newsarticle/tr:w-1200,q-80,l-text,i-${credit},l-end/gregor-kobel-borussia-dortmund-2025-2026.jpg?updatedAt=1763054344030`;
    expect(bannerKey(u("A"))).toBe("gregor-kobel-borussia-dortmund-2025-2026-1763054344030");
    expect(bannerKey(u("A"))).toBe(bannerKey(u("B")));
    expect(bannerKey("https://x/../evil name!.jpg")).toBe("evil-name");
  });
});

describe("ensureImage", () => {
  it("downloads once and then reuses the local file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ti-"));
    const { f, calls } = fetcher();
    const url = "https://cdn.ligainsider.de/images/player/team/minor/gregor-kobel-dortmund-2627.jpg";
    expect(await ensureImage(f, dir, "players", 9357, url)).toBe("/img/players/9357.jpg");
    expect(await ensureImage(f, dir, "players", 9357, url)).toBe("/img/players/9357.jpg");
    expect(calls).toHaveLength(1);
    expect([...readFileSync(join(dir, "img/players/9357.jpg"))]).toEqual([7, 7]);
  });

  it("keeps png extension for crests, ignoring query strings", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ti-"));
    expect(await ensureImage(fetcher().f, dir, "clubs", 14, "https://x/wappen.png?v=2")).toBe("/img/clubs/14.png");
  });

  it("returns undefined without url or when the download fails", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ti-"));
    expect(await ensureImage(fetcher().f, dir, "players", 1, undefined)).toBeUndefined();
    expect(await ensureImage(fetcher(true).f, dir, "players", 1, "https://x/a.jpg")).toBeUndefined();
  });
});
