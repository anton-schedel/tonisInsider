import { describe, it, expect } from "vitest";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "./store.ts";
import { restoreFromSite, writeSnapshot, writeVersion } from "./snapshot.ts";
import { HttpError, type Fetcher } from "./fetch.ts";
import type { Article } from "./types.ts";

const article: Article = {
  id: 1, url: "https://www.ligainsider.de/x_1/y-1/", headline: "H", listHeadline: "H",
  category: "bundesliga", newsType: "fit",
  player: { id: 9357, slug: "gregor-kobel", name: "Gregor Kobel", photo: "/img/players/9357.jpg" },
  club: { id: 14, slug: "borussia-dortmund", name: "Borussia Dortmund", crest: "/img/clubs/14.png" },
  publishedAt: "2026-10-07T07:32:00.000Z", bodyHtml: "<p>Text</p>", fetchedAt: "2026-10-07T08:00:00.000Z",
};

describe("snapshot", () => {
  it("round-trips the store through our own site, including images", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ti-"));
    const source = new Store(join(dir, "a"));
    source.putArticle(article);
    source.putState({ lastChangeAt: "2026-10-07T08:00:00.000Z" });
    const file = join(dir, "snapshot.json");
    writeSnapshot(source, file);

    const requested: string[] = [];
    const fetcher: Fetcher = {
      async text(url) { requested.push(url); return readFileSync(file, "utf8"); },
      async binary(url) { requested.push(url); return new Uint8Array([1]); },
    };
    const target = new Store(join(dir, "b"));
    const publicDir = join(dir, "public");
    expect(await restoreFromSite(target, fetcher, "https://ti.example/", publicDir)).toBe(true);
    expect(target.getArticle(1)).toEqual(article);
    expect(target.state().lastChangeAt).toBe("2026-10-07T08:00:00.000Z");
    expect(requested).toContain("https://ti.example/data/snapshot.json");
    expect(requested).toContain("https://ti.example/img/players/9357.jpg");
    expect(existsSync(join(publicDir, "img/clubs/14.png"))).toBe(true);
  });

  it.each([
    ["a missing snapshot (404) as none", async (url: string) => { throw new HttpError(404, url); }, false],
    ["another failure by throwing, instead of starting fresh (would wipe history)", async (url: string) => { throw new HttpError(503, url); }, "HTTP 503"],
    ["something that is not a snapshot by throwing", async () => "<!doctype html><p>Fehler</p>", ""],
  ] as const)("treats %s", async (_, text, outcome) => {
    const dir = mkdtempSync(join(tmpdir(), "ti-"));
    const fetcher: Fetcher = { text, async binary() { return new Uint8Array(); } };
    const restore = restoreFromSite(new Store(join(dir, "s")), fetcher, "https://ti.example", join(dir, "p"));
    if (outcome === false) expect(await restore).toBe(false);
    else await expect(restore).rejects.toThrow(outcome);
  });
});

describe("writeVersion", () => {
  it("writes the newest Bundesliga article and the last update, for open pages to poll", () => {
    const dir = mkdtempSync(join(tmpdir(), "ti-v-"));
    const store = new Store(join(dir, "s"));
    store.putArticle({ ...article, id: 5, publishedAt: "2026-10-07T10:00:00.000Z" });
    store.putArticle({ ...article, id: 7, publishedAt: "2026-10-07T12:00:00.000Z" });
    store.putArticle({ ...article, id: 9, category: "testspiele", publishedAt: "2026-10-07T13:00:00.000Z" });
    store.putState({ lastChangeAt: "2026-10-07T12:01:00.000Z" });
    const file = join(dir, "public", "data", "version.json");
    writeVersion(store, file);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ newest: 7, updated: "2026-10-07T12:01:00.000Z" });
  });
});
