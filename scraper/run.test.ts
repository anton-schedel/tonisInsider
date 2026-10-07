import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run, lineupsDue } from "./run.ts";
import { Store } from "./store.ts";
import { HttpError, type Fetcher } from "./fetch.ts";
import type { Lineup } from "./types.ts";

const fx = (name: string) => readFileSync(join(import.meta.dirname, "__fixtures__", name), "utf8");
const NOW = new Date("2026-10-07T09:00:00Z");

/** Serves fixtures by URL; any article URL gets the Kobel or Can article, any club page gets BVB or TSG. */
function fakeFetcher(overrides: Record<string, string | number> = {}) {
  const calls: string[] = [];
  const fetcher: Fetcher = {
    async text(url) {
      calls.push(url);
      const o = overrides[url];
      if (typeof o === "number") throw new HttpError(o, url);
      if (typeof o === "string") return o;
      if (url.endsWith("/bundesliga-news/uebersicht/") || url.includes("/startpage/uebersicht/")) return fx("news-bundesliga.html");
      if (url.includes("/testspiele-news/uebersicht/")) return fx("news-testspiele.html");
      if (url.includes("418776")) return fx("article-can.html");
      if (/-\d{6}\/$/.test(url)) return fx("article-kobel.html");
      if (url.endsWith("/tsg-hoffenheim/10/")) return fx("club-tsg.html");
      if (/\/[a-z0-9-]+\/\d+\/$/.test(url)) return fx("club-bvb.html");
      throw new Error(`unexpected url ${url}`);
    },
    async binary(url) {
      calls.push(url);
      return new Uint8Array([1, 2, 3]);
    },
  };
  return { fetcher, calls };
}

describe("run", () => {
  let store: Store;
  let publicDir: string;
  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), "ti-"));
    store = new Store(join(dir, "store"));
    publicDir = join(dir, "public");
  });

  it("first run backfills articles and lineups and reports a change", async () => {
    const { fetcher } = fakeFetcher();
    const res = await run({ store, fetcher, publicDir, now: NOW });
    expect(res.changed).toBe(true);
    expect(res.newArticles).toBe(15);
    expect(store.getArticle(418776)?.category).toBe("bundesliga");
    expect(store.lineups()).toHaveLength(18);
    expect(store.getLineup("tsg-hoffenheim")?.formation).toBe("4-4-2");
    expect(store.state().lineupsFetchedAt).toBe(NOW.toISOString());
    expect(res.lineupsChecked).toBe(true);
  });

  it("second run with nothing new fetches only the overviews and reports unchanged", async () => {
    await run({ store, fetcher: fakeFetcher().fetcher, publicDir, now: NOW });
    const { fetcher, calls } = fakeFetcher();
    const res = await run({ store, fetcher, publicDir, now: new Date(NOW.getTime() + 5 * 60_000) });
    expect(res.changed).toBe(false);
    expect(res.lineupsChecked).toBe(false);
    expect(res.newArticles).toBe(0);
    expect(calls).toEqual(["https://www.ligainsider.de/bundesliga-news/uebersicht/"]);
  });

  it("re-fetches an article whose headline changed in the overview", async () => {
    await run({ store, fetcher: fakeFetcher().fetcher, publicDir, now: NOW });
    const edited = fx("news-bundesliga.html").replace("Can muss sich bis ins neue Jahr gedulden", "Can fällt länger aus");
    const { fetcher, calls } = fakeFetcher({ "https://www.ligainsider.de/bundesliga-news/uebersicht/": edited });
    const res = await run({ store, fetcher, publicDir, now: new Date(NOW.getTime() + 5 * 60_000) });
    expect(calls.some((u) => u.includes("418776"))).toBe(true);
    expect(res.changed).toBe(true);
    expect(res.newArticles).toBe(0);
  });

  it("keeps the old article and reports a problem when the new version fails validation", async () => {
    await run({ store, fetcher: fakeFetcher().fetcher, publicDir, now: NOW });
    const before = store.getArticle(418776)!;
    const edited = fx("news-bundesliga.html").replace("Can muss sich bis ins neue Jahr gedulden", "Can fällt länger aus");
    const { fetcher } = fakeFetcher({
      "https://www.ligainsider.de/bundesliga-news/uebersicht/": edited,
      [before.url]: "<html><body>Wartungsarbeiten</body></html>",
    });
    const res = await run({ store, fetcher, publicDir, now: new Date(NOW.getTime() + 5 * 60_000) });
    expect(res.problems.some((p) => p.startsWith("article 418776"))).toBe(true);
    expect(store.getArticle(418776)).toEqual(before);
  });

  it("remembers listed articles that 404 and does not retry them or report a problem", async () => {
    const gone = "https://www.ligainsider.de/emre-can_1812/can-muss-sich-bis-ins-neue-jahr-gedulden-418776/";
    const first = await run({ store, fetcher: fakeFetcher({ [gone]: 404 }).fetcher, publicDir, now: NOW });
    expect(first.problems).toEqual([]);
    expect(store.getArticle(418776)).toBeUndefined();
    const { fetcher, calls } = fakeFetcher({ [gone]: 404 });
    await run({ store, fetcher, publicDir, now: new Date(NOW.getTime() + 5 * 60_000) });
    expect(calls).not.toContain(gone);
  });

  it("reports an article that fails validation once, then skips it until its headline changes", async () => {
    const url = "https://www.ligainsider.de/emre-can_1812/can-muss-sich-bis-ins-neue-jahr-gedulden-418776/";
    const broken = "<html><body>Nur ein Video</body></html>";
    const first = await run({ store, fetcher: fakeFetcher({ [url]: broken }).fetcher, publicDir, now: NOW });
    expect(first.problems.filter((p) => p.startsWith("article 418776"))).toHaveLength(1);
    expect(first.stateChanged).toBe(true);
    const { fetcher, calls } = fakeFetcher({ [url]: broken });
    const second = await run({ store, fetcher, publicDir, now: new Date(NOW.getTime() + 5 * 60_000) });
    expect(calls).not.toContain(url);
    expect(second.problems).toEqual([]);
  });

  it("retries articles that failed validation when the code version changes, and forces a rebuild", async () => {
    const url = "https://www.ligainsider.de/emre-can_1812/can-muss-sich-bis-ins-neue-jahr-gedulden-418776/";
    await run({ store, fetcher: fakeFetcher({ [url]: "<html></html>" }).fetcher, publicDir, now: NOW, codeVersion: "a" });
    const later = new Date(NOW.getTime() + 5 * 60_000);
    const unchanged = await run({ store, fetcher: fakeFetcher().fetcher, publicDir, now: later, codeVersion: "a" });
    expect(unchanged.changed).toBe(false);
    const { fetcher, calls } = fakeFetcher();
    const res = await run({ store, fetcher, publicDir, now: later, codeVersion: "b" });
    expect(res.changed).toBe(true);
    expect(calls).toContain(url);
    expect(store.getArticle(418776)).toBeDefined();
  });

  it("reports a problem when the club list cannot be parsed (lineups would go stale)", async () => {
    const noNav = fx("news-bundesliga.html").replaceAll("/verein/news/", "/verein/x/");
    const { fetcher } = fakeFetcher({ "https://www.ligainsider.de/bundesliga-news/uebersicht/": noNav });
    const res = await run({ store, fetcher, publicDir, now: NOW });
    expect(res.problems).toContain("clubs: expected 18, got 0");
  });

  it("deletes stored lineups of clubs that are no longer in the league", async () => {
    store.putLineup({ club: { id: 999, slug: "abgestiegen-fc", name: "Abgestiegen FC" }, formation: "", lines: [], updatedAt: "x" });
    const res = await run({ store, fetcher: fakeFetcher().fetcher, publicDir, now: NOW });
    expect(res.changed).toBe(true);
    expect(store.getLineup("abgestiegen-fc")).toBeUndefined();
    expect(store.lineups()).toHaveLength(18);
  });

  it("reports a problem when an overview suddenly has no articles (HTML changed)", async () => {
    const { fetcher } = fakeFetcher({ "https://www.ligainsider.de/bundesliga-news/uebersicht/": "<html></html>" });
    const res = await run({ store, fetcher, publicDir, now: NOW });
    expect(res.problems).toContain("bundesliga: overview returned 0 articles");
  });

  it("deletes articles older than 30 days that are no longer listed", async () => {
    await run({ store, fetcher: fakeFetcher().fetcher, publicDir, now: NOW });
    const later = new Date(NOW.getTime() + 40 * 24 * 60 * 60_000);
    const empty = fx("news-bundesliga.html").replace(/class="feature_column /g, 'class="gone ');
    const { fetcher } = fakeFetcher({
      "https://www.ligainsider.de/bundesliga-news/uebersicht/": empty,
      "https://www.ligainsider.de/testspiele-news/uebersicht/": empty,
    });
    const res = await run({ store, fetcher, publicDir, now: later });
    expect(res.changed).toBe(true);
    expect(store.articles()).toHaveLength(0);
  });

  it("keeps old articles that LigaInsider still lists, so they are not re-fetched every run", async () => {
    await run({ store, fetcher: fakeFetcher().fetcher, publicDir, now: NOW });
    const later = new Date(NOW.getTime() + 40 * 24 * 60 * 60_000);
    await run({ store, fetcher: fakeFetcher().fetcher, publicDir, now: later });
    const { fetcher, calls } = fakeFetcher();
    await run({ store, fetcher, publicDir, now: new Date(later.getTime() + 5 * 60_000) });
    expect(calls.filter((u) => /-\d{6}\/$/.test(u))).toEqual([]);
  });
});

describe("lineupsDue", () => {
  const lineup = (kickoff?: string) => ({ kickoff }) as Lineup;
  const at = (min: number) => new Date(NOW.getTime() + min * 60_000);

  it("is due when never fetched", () => {
    expect(lineupsDue([], undefined, NOW)).toBe(true);
  });
  it("waits 30 minutes when no kickoff is near", () => {
    const far = lineup("2026-10-20T13:30:00Z");
    expect(lineupsDue([far], NOW.toISOString(), at(20))).toBe(false);
    expect(lineupsDue([far], NOW.toISOString(), at(30))).toBe(true);
  });
  it("waits only 10 minutes within 48 h of a kickoff", () => {
    const near = lineup("2026-10-08T18:30:00Z");
    expect(lineupsDue([near], NOW.toISOString(), at(5))).toBe(false);
    expect(lineupsDue([near], NOW.toISOString(), at(10))).toBe(true);
  });
});
