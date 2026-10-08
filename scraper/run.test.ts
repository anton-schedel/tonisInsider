import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run, lineupsDue } from "./run.ts";
import { oddsUrl } from "./odds.ts";
import { euPropsUrl, scorerOddsUrl, usPropsUrl } from "./scorers.ts";
import { Store } from "./store.ts";
import { HttpError, type Fetcher } from "./fetch.ts";
import type { Lineup } from "./types.ts";

const fx = (name: string) => readFileSync(join(import.meta.dirname, "__fixtures__", name), "utf8");
const NOW = new Date("2026-10-07T09:00:00Z");
const OVERVIEW = "https://www.ligainsider.de/bundesliga-news/uebersicht/";
/** The saved overview says "Vor 46 Min." forever; hours later LigaInsider would show older times. */
const overviewLater = () => fx("news-bundesliga.html").replace(/Vor \d+ (Min|Std)\./g, "Gestern");

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

  const ODDS = JSON.stringify([{
    home_team: "Borussia Dortmund", away_team: "Werder Bremen", commence_time: "2026-10-09T18:30:00Z",
    bookmakers: [{ key: "a", markets: [{ key: "h2h", outcomes: [{ name: "Borussia Dortmund", price: 1.6 }, { name: "Draw", price: 4.3 }, { name: "Werder Bremen", price: 5.2 }] }] }],
  }]);

  it("fetches odds when a key is set and stores the chances", async () => {
    const { fetcher, calls } = fakeFetcher({ [oddsUrl("SECRET")]: ODDS });
    const r = await run({ store, fetcher, publicDir, now: NOW, oddsApiKey: "SECRET" });
    expect(calls).toContain(oddsUrl("SECRET"));
    expect(store.state().odds?.[0]).toMatchObject({ home: "Borussia Dortmund", chances: { home: 60, draw: 22, away: 18 } });
    expect(store.state().oddsFetchedAt).toBe(NOW.toISOString());
    expect(r.changed).toBe(true);
  });

  it("doesn't fetch odds without a key, or again too soon", async () => {
    const a = fakeFetcher({ [oddsUrl("SECRET")]: ODDS });
    await run({ store, fetcher: a.fetcher, publicDir, now: NOW });
    expect(a.calls.some((u) => u.includes("the-odds-api"))).toBe(false);
    await run({ store, fetcher: a.fetcher, publicDir, now: NOW, oddsApiKey: "SECRET" });
    const b = fakeFetcher({ [oddsUrl("SECRET")]: ODDS });
    await run({ store, fetcher: b.fetcher, publicDir, now: new Date(NOW.getTime() + 2.5 * 60 * 60_000), oddsApiKey: "SECRET" });
    expect(b.calls.some((u) => u.includes("the-odds-api"))).toBe(false);
  });

  it("doesn't rebuild when the shown percentages stay the same", async () => {
    await run({ store, fetcher: fakeFetcher({ [oddsUrl("K")]: ODDS }).fetcher, publicDir, now: NOW, oddsApiKey: "K" });
    const later = new Date(NOW.getTime() + 3 * 60 * 60_000);
    const r = await run({ store, fetcher: fakeFetcher({ [oddsUrl("K")]: ODDS, [OVERVIEW]: overviewLater() }).fetcher, publicDir, now: later, oddsApiKey: "K" });
    expect(r.changed).toBe(false);
    expect(r.stateChanged).toBe(true);
  });

  it("reports a rejected key without ever printing it, and keeps the last odds", async () => {
    await run({ store, fetcher: fakeFetcher({ [oddsUrl("SECRET")]: ODDS }).fetcher, publicDir, now: NOW, oddsApiKey: "SECRET" });
    const later = new Date(NOW.getTime() + 4 * 60 * 60_000);
    const r = await run({ store, fetcher: fakeFetcher({ [oddsUrl("SECRET")]: 401 }).fetcher, publicDir, now: later, oddsApiKey: "SECRET" });
    expect(r.problems).toEqual(["odds: HTTP 401, check the ODDS_API_KEY secret"]);
    expect(JSON.stringify(r.problems)).not.toContain("SECRET");
    expect(store.state().odds).toHaveLength(1);
    expect(store.state().oddsFetchedAt).toBe(later.toISOString());
  });

  it("only logs other odds failures (they retry at the next due time)", async () => {
    const r = await run({ store, fetcher: fakeFetcher({ [oddsUrl("SECRET")]: 500 }).fetcher, publicDir, now: NOW, oddsApiKey: "SECRET" });
    expect(r.problems).toEqual([]);
  });

  // NOW is 2026-10-07T09:00Z; this kickoff is 33.5 h later, inside the 40 h window.
  const ODDS_WITH_ID = JSON.stringify([{ ...JSON.parse(ODDS)[0], id: "e1", commence_time: "2026-10-07T18:30:00Z" }]);
  const SCORERS = JSON.stringify({
    id: "e1", home_team: "Borussia Dortmund", away_team: "Werder Bremen", commence_time: "2026-10-07T18:30:00Z",
    bookmakers: [{ key: "a", markets: [{ key: "player_goal_scorer_anytime", outcomes: [{ name: "Yes", description: "Serhou Guirassy", price: 1.6 }] }] }],
  });

  const WH = JSON.stringify({
    bookmakers: [{ key: "williamhill", markets: [{ key: "player_to_score_or_assist", outcomes: [{ name: "Yes", description: "Serhou Guirassy", price: 1.3 }] }] }],
  });

  it("fetches the full set of player odds for the coming matchday and stores it", async () => {
    const { fetcher, calls } = fakeFetcher({ [oddsUrl("K")]: ODDS_WITH_ID, [usPropsUrl("K", "e1")]: SCORERS, [euPropsUrl("K", "e1")]: WH });
    const r = await run({ store, fetcher, publicDir, now: NOW, oddsApiKey: "K" });
    expect(calls).toContain(usPropsUrl("K", "e1"));
    expect(calls).toContain(euPropsUrl("K", "e1"));
    const m = store.state().scorers?.e1;
    expect(m?.players[0]).toMatchObject({ name: "Serhou Guirassy", books: 1 });
    expect(m?.scoreOrAssist?.[0].name).toBe("Serhou Guirassy");
    expect(m?.fullAt).toBe(NOW.toISOString());
    expect(r.changed).toBe(true);

    const again = fakeFetcher({ [oddsUrl("K")]: ODDS_WITH_ID });
    await run({ store, fetcher: again.fetcher, publicDir, now: new Date(NOW.getTime() + 3 * 3600_000), oddsApiKey: "K" });
    expect(again.calls.some((u) => u.includes("/events/e1/"))).toBe(false);
  });

  it("refreshes only the goalscorer odds close to kickoff and keeps the rest", async () => {
    await run({ store, fetcher: fakeFetcher({ [oddsUrl("K")]: ODDS_WITH_ID, [usPropsUrl("K", "e1")]: SCORERS, [euPropsUrl("K", "e1")]: WH }).fetcher, publicDir, now: NOW, oddsApiKey: "K" });
    const late = fakeFetcher({ [oddsUrl("K")]: ODDS_WITH_ID, [scorerOddsUrl("K", "e1")]: SCORERS });
    await run({ store, fetcher: late.fetcher, publicDir, now: new Date("2026-10-07T14:00:00Z"), oddsApiKey: "K" });
    expect(late.calls).toContain(scorerOddsUrl("K", "e1"));
    expect(late.calls).not.toContain(usPropsUrl("K", "e1"));
    expect(store.state().scorers?.e1.scoreOrAssist?.[0].name).toBe("Serhou Guirassy");
    expect(store.state().scorers?.e1.fetchedAt).toBe("2026-10-07T14:00:00.000Z");
  });

  it("stores the full set even when the William Hill part fails (no paid retry loop)", async () => {
    await run({ store, fetcher: fakeFetcher({ [oddsUrl("K")]: ODDS_WITH_ID, [usPropsUrl("K", "e1")]: SCORERS, [euPropsUrl("K", "e1")]: 500 }).fetcher, publicDir, now: NOW, oddsApiKey: "K" });
    expect(store.state().scorers?.e1.fullAt).toBe(NOW.toISOString());
    expect(store.state().scorers?.e1.scoreOrAssist).toEqual([]);
  });

  it("asks William Hill again later when its part was missing, keeping the rest", async () => {
    await run({ store, fetcher: fakeFetcher({ [oddsUrl("K")]: ODDS_WITH_ID, [usPropsUrl("K", "e1")]: SCORERS, [euPropsUrl("K", "e1")]: "{}" }).fetcher, publicDir, now: NOW, oddsApiKey: "K" });
    expect(store.state().scorers?.e1.scoreOrAssist).toEqual([]);
    const later = fakeFetcher({ [oddsUrl("K")]: ODDS_WITH_ID, [euPropsUrl("K", "e1")]: WH });
    await run({ store, fetcher: later.fetcher, publicDir, now: new Date(NOW.getTime() + 6 * 3600_000), oddsApiKey: "K" });
    expect(later.calls).toContain(euPropsUrl("K", "e1"));
    expect(later.calls).not.toContain(usPropsUrl("K", "e1"));
    expect(store.state().scorers?.e1.scoreOrAssist?.[0].name).toBe("Serhou Guirassy");
    expect(store.state().scorers?.e1.players[0].name).toBe("Serhou Guirassy");
  });

  it("keeps going when player odds fail, without printing the key", async () => {
    const r = await run({ store, fetcher: fakeFetcher({ [oddsUrl("SECRET")]: ODDS_WITH_ID, [usPropsUrl("SECRET", "e1")]: 500 }).fetcher, publicDir, now: NOW, oddsApiKey: "SECRET" });
    expect(r.problems).toEqual([]);
    expect(store.state().odds).toHaveLength(1);
  });

  it("downloads each article's banner photo once and stores its local path", async () => {
    const { fetcher, calls } = fakeFetcher();
    await run({ store, fetcher, publicDir, now: NOW });
    const a = store.getArticle(418778)!;
    expect(a.banner).toBe("/img/articles/gregor-kobel-borussia-dortmund-2025-2026-1763054344030.jpg");
    // Articles sharing a photo share one download: one request per distinct photo, not per article.
    const photos = new Set(store.articles().map((x) => x.banner));
    expect(store.articles().length).toBeGreaterThan(photos.size);
    expect(calls.filter((u) => u.includes("/newsarticle/")).length).toBe(photos.size);
  });

  it("looks once for the banner of articles stored before banners existed, while they are still listed", async () => {
    await run({ store, fetcher: fakeFetcher().fetcher, publicDir, now: NOW });
    const old = store.getArticle(418778)!;
    delete (old as { banner?: unknown }).banner;
    store.putArticle(old);
    const again = fakeFetcher();
    await run({ store, fetcher: again.fetcher, publicDir, now: NOW });
    expect(again.calls.some((u) => u.includes("418778"))).toBe(true);
    expect(store.getArticle(418778)!.banner).toMatch(/^\/img\/articles\//);
    const third = fakeFetcher();
    await run({ store, fetcher: third.fetcher, publicDir, now: NOW });
    expect(third.calls.some((u) => u.includes("418778"))).toBe(false);
  });

  it("remembers which articles LigaInsider pins on top of its list", async () => {
    await run({ store, fetcher: fakeFetcher().fetcher, publicDir, now: NOW });
    // Make the first listed article older than the rest, like LigaInsider's pinned PK overview.
    const first = store.getArticle(418765)!;
    store.putArticle({ ...first, publishedAt: "2026-10-01T10:00:00.000Z" });
    const r = await run({ store, fetcher: fakeFetcher().fetcher, publicDir, now: NOW });
    expect(store.state().pinned).toEqual([418765]);
    expect(r.changed).toBe(true);
  });

  it("re-reads an article LigaInsider republished under the same headline (newer listing time)", async () => {
    await run({ store, fetcher: fakeFetcher().fetcher, publicDir, now: NOW });
    // Stored (and last seen in the list) on Tuesday, but the overview now lists it as 'Vor 46 Min.'.
    store.putArticle({ ...store.getArticle(418775)!, publishedAt: "2026-10-05T18:00:00.000Z", listedAt: "2026-10-05T18:10:00.000Z" });
    const again = fakeFetcher();
    await run({ store, fetcher: again.fetcher, publicDir, now: NOW });
    expect(again.calls.some((u) => u.includes("418775"))).toBe(true);
    expect(store.getArticle(418775)!.publishedAt).not.toBe("2026-10-05T18:00:00.000Z");
  });

  it("re-reads a republished article only once, even if its page still shows the old date", async () => {
    await run({ store, fetcher: fakeFetcher().fetcher, publicDir, now: NOW });
    store.putArticle({ ...store.getArticle(418775)!, publishedAt: "2026-10-05T18:00:00.000Z", listedAt: "2026-10-05T18:10:00.000Z" });
    // The article page itself keeps showing the old date.
    const oldPage = fx("article-kobel.html").replace("07.10.2026 - 09:32", "05.10.2026 - 20:00");
    const url = store.getArticle(418775)!.url;
    await run({ store, fetcher: fakeFetcher({ [url]: oldPage }).fetcher, publicDir, now: NOW });
    const third = fakeFetcher({ [url]: oldPage });
    await run({ store, fetcher: third.fetcher, publicDir, now: new Date(NOW.getTime() + 5 * 60_000) });
    expect(third.calls.some((u) => u.includes("418775"))).toBe(false);
  });

  it("doesn't re-read articles whose listing time matches their date", async () => {
    await run({ store, fetcher: fakeFetcher().fetcher, publicDir, now: NOW });
    const again = fakeFetcher();
    await run({ store, fetcher: again.fetcher, publicDir, now: NOW });
    expect(again.calls.filter((u) => /-\d{6}\/$/.test(u))).toEqual([]);
  });

  it("saves comment counts from the overview without triggering a rebuild", async () => {
    await run({ store, fetcher: fakeFetcher().fetcher, publicDir, now: NOW });
    const second = await run({ store, fetcher: fakeFetcher().fetcher, publicDir, now: NOW });
    expect(store.state().commentCounts?.["418778"]).toBe(3);
    expect(second.changed).toBe(false);

    const bumped = fx("news-bundesliga.html").replace(/(418778\/#comments"><i class="fa fa-comments"><\/i><small>)3/, "$13" + "1");
    const fetcher = fakeFetcher({ "https://www.ligainsider.de/bundesliga-news/uebersicht/": bumped }).fetcher;
    const third = await run({ store, fetcher, publicDir, now: NOW });
    expect(store.state().commentCounts?.["418778"]).toBe(31);
    expect(third.changed).toBe(false);
    expect(third.stateChanged).toBe(true);
  });

  it("keeps the last known count when an article shows no count any more", async () => {
    await run({ store, fetcher: fakeFetcher().fetcher, publicDir, now: NOW });
    const counts = store.state().commentCounts!;
    const empty = fx("news-bundesliga.html").replace(/small_comment_top/g, "x");
    await run({ store, fetcher: fakeFetcher({ "https://www.ligainsider.de/bundesliga-news/uebersicht/": empty }).fetcher, publicDir, now: NOW });
    expect(store.state().commentCounts).toEqual(counts);
    for (const id of Object.keys(counts)) expect(store.getArticle(Number(id)) ?? null).not.toBeNull();
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
    await run({ store, fetcher: fakeFetcher({ [OVERVIEW]: overviewLater() }).fetcher, publicDir, now: later });
    const { fetcher, calls } = fakeFetcher({ [OVERVIEW]: overviewLater() });
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
