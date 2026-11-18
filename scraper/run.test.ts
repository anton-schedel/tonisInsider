import { describe, it, expect, beforeEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run, lineupsDue } from "./run.ts";
import { oddsUrl } from "./odds.ts";
import { assistsUrl, propsUrl, scorerOddsUrl } from "./scorers.ts";
import { Store } from "./store.ts";
import * as cheerio from "cheerio";
import { parseArticle } from "./parse/article.ts";
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

  it("keeps a match's kickoff when a later read of the club page can't tell it", async () => {
    await run({ store, fetcher: fakeFetcher().fetcher, publicDir, now: NOW });
    const before = store.getLineup("borussia-dortmund");
    expect(before?.kickoff).toBe("2026-10-09T18:30:00.000Z");
    // Same match, but the date is gone from the page (e.g. a wording the parser doesn't know).
    const { fetcher } = fakeFetcher();
    const noDate: Fetcher = {
      ...fetcher,
      async text(url) {
        const html = await fetcher.text(url);
        return /\/borussia-dortmund\/\d+\/$/.test(url) ? html.replace(/\d{2}\.\d{2}\.\d{4}/g, "") : html;
      },
    };
    await run({ store, fetcher: noDate, publicDir, now: new Date(NOW.getTime() + 60 * 60_000) });
    expect(store.getLineup("borussia-dortmund")?.kickoff).toBe("2026-10-09T18:30:00.000Z");
  });

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

  // NOW is 2026-10-07T09:00Z; this kickoff is 33.5 h later, inside the 40 h window.
  const ODDS_WITH_ID = JSON.stringify([{ ...JSON.parse(ODDS)[0], id: "e1", commence_time: "2026-10-07T18:30:00Z" }]);
  const SCORERS = JSON.stringify({
    id: "e1", home_team: "Borussia Dortmund", away_team: "Werder Bremen", commence_time: "2026-10-07T18:30:00Z",
    bookmakers: [{ key: "a", markets: [{ key: "player_goal_scorer_anytime", outcomes: [{ name: "Yes", description: "Serhou Guirassy", price: 1.6 }] }] }],
  });

  const FULL = JSON.stringify({
    ...JSON.parse(SCORERS),
    bookmakers: [{ key: "a", markets: [
      ...JSON.parse(SCORERS).bookmakers[0].markets,
      { key: "player_assists_alternate", outcomes: [{ name: "Over", description: "Serhou Guirassy", price: 3.6, point: 0.5 }] },
    ] }],
  });

  it("fetches the full set of player odds for the coming matchday and stores it", async () => {
    const { fetcher, calls } = fakeFetcher({ [oddsUrl("K")]: ODDS_WITH_ID, [propsUrl("K", "e1")]: FULL });
    const r = await run({ store, fetcher, publicDir, now: NOW, oddsApiKey: "K" });
    expect(calls).toContain(propsUrl("K", "e1"));
    const m = store.state().scorers?.e1;
    expect(m?.players[0]).toMatchObject({ name: "Serhou Guirassy", books: 1 });
    expect(m?.assists?.[0].name).toBe("Serhou Guirassy");
    expect(m?.fullAt).toBe(NOW.toISOString());
    expect(r.changed).toBe(true);

    const again = fakeFetcher({ [oddsUrl("K")]: ODDS_WITH_ID });
    await run({ store, fetcher: again.fetcher, publicDir, now: new Date(NOW.getTime() + 3 * 3600_000), oddsApiKey: "K" });
    expect(again.calls.some((u) => u.includes("/events/e1/"))).toBe(false);
  });

  it("refreshes only the goalscorer odds close to kickoff and keeps the rest", async () => {
    await run({ store, fetcher: fakeFetcher({ [oddsUrl("K")]: ODDS_WITH_ID, [propsUrl("K", "e1")]: FULL }).fetcher, publicDir, now: NOW, oddsApiKey: "K" });
    const late = fakeFetcher({ [oddsUrl("K")]: ODDS_WITH_ID, [scorerOddsUrl("K", "e1")]: SCORERS });
    await run({ store, fetcher: late.fetcher, publicDir, now: new Date("2026-10-07T14:00:00Z"), oddsApiKey: "K" });
    expect(late.calls).toContain(scorerOddsUrl("K", "e1"));
    expect(late.calls).not.toContain(propsUrl("K", "e1"));
    expect(store.state().scorers?.e1.assists?.[0].name).toBe("Serhou Guirassy");
    expect(store.state().scorers?.e1.fetchedAt).toBe("2026-10-07T14:00:00.000Z");
  });

  it("asks for missing assists again later, keeping the rest", async () => {
    await run({ store, fetcher: fakeFetcher({ [oddsUrl("K")]: ODDS_WITH_ID, [propsUrl("K", "e1")]: SCORERS }).fetcher, publicDir, now: NOW, oddsApiKey: "K" });
    expect(store.state().scorers?.e1.assists).toEqual([]);
    const later = fakeFetcher({ [oddsUrl("K")]: ODDS_WITH_ID, [assistsUrl("K", "e1")]: FULL });
    await run({ store, fetcher: later.fetcher, publicDir, now: new Date(NOW.getTime() + 6 * 3600_000), oddsApiKey: "K" });
    expect(later.calls).toContain(assistsUrl("K", "e1"));
    expect(later.calls).not.toContain(propsUrl("K", "e1"));
    expect(store.state().scorers?.e1.assists?.[0].name).toBe("Serhou Guirassy");
    expect(store.state().scorers?.e1.players[0].name).toBe("Serhou Guirassy");
  });

  it.each([
    ["the odds", { [oddsUrl("SECRET")]: 500 }, 0],
    ["the player odds", { [oddsUrl("SECRET")]: ODDS_WITH_ID, [propsUrl("SECRET", "e1")]: 500 }, 1],
  ])("only logs other failures of %s (they retry at the next due time) and keeps going", async (_, overrides, odds) => {
    const r = await run({ store, fetcher: fakeFetcher(overrides).fetcher, publicDir, now: NOW, oddsApiKey: "SECRET" });
    expect(r.problems).toEqual([]);
    expect(store.state().odds ?? []).toHaveLength(odds);
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

  /** The national U21's news: LigaInsider files it under a club of its own, with its crest beside the headline. */
  const U21_URL = "https://www.ligainsider.de/deutschland-u21/33166/em-quali-fix-deutschlands-u21-besiegt-georgien-418765/";
  const U21_CREST = "https://cdn.ligainsider.de/images/teams/medium/deutschland-u21-wappen.png";
  const u21Page = () => fx("article-kobel.html").replace(/<div class="news_title_box">[\s\S]*?<h2>/,
    `<div class="news_title_box"><div class="news_top_icon"><a href="/deutschland-u21/33166/"><img src="${U21_CREST}" alt=""/></a></div>` +
    `<strong><a href="/deutschland-u21/33166/">Deutschland U21</a></strong><h2>`);

  it("a club outside the Bundesliga (the national teams) gets the crest beside the article's headline", async () => {
    const { fetcher, calls } = fakeFetcher({ [U21_URL]: u21Page() });
    await run({ store, fetcher, publicDir, now: NOW });
    expect(store.getArticle(418765)!.club).toEqual({ id: 33166, slug: "deutschland-u21", name: "Deutschland U21", crest: "/img/clubs/33166.png" });
    expect(calls).toContain(U21_CREST);
  });

  it("an article stored without its club's crest: one another article brought, else its page is read once", async () => {
    await run({ store, fetcher: fakeFetcher({ [U21_URL]: u21Page() }).fetcher, publicDir, now: NOW });
    const crestless = () => {
      const a = store.getArticle(418765)!;
      delete a.club!.crest;
      store.putArticle(a);
    };
    // The crest is here already (another article brought it): no request.
    crestless();
    const second = fakeFetcher({ [U21_URL]: u21Page() });
    const r = await run({ store, fetcher: second.fetcher, publicDir, now: NOW });
    expect(store.getArticle(418765)!.club?.crest).toBe("/img/clubs/33166.png");
    expect(second.calls).not.toContain(U21_URL);
    expect(r.changed).toBe(true);
    // Not here: the article's page is read once for it…
    crestless();
    rmSync(join(publicDir, "img/clubs/33166.png"));
    const third = fakeFetcher({ [U21_URL]: u21Page() });
    await run({ store, fetcher: third.fetcher, publicDir, now: NOW });
    expect(third.calls.filter((u) => u === U21_URL)).toHaveLength(1);
    expect(store.getArticle(418765)!.club?.crest).toBe("/img/clubs/33166.png");
    expect(existsSync(join(publicDir, "img/clubs/33166.png"))).toBe(true);
    // …and not again, even if it brought none.
    crestless();
    rmSync(join(publicDir, "img/clubs/33166.png"));
    const fourth = fakeFetcher({ [U21_URL]: u21Page() });
    await run({ store, fetcher: fourth.fetcher, publicDir, now: NOW });
    expect(fourth.calls).not.toContain(U21_URL);
  });

  // A match report read right after the final whistle: LigaInsider's page has only the bare grade headings.
  const REPORT_URL = "https://www.ligainsider.de/borussia-dortmund/14/bvb-verspielt-spaete-zwei-tore-fuehrung-gegen-bremen-999001/";
  const reportPage = (form: "waiting" | "graded" | "ungraded") => {
    if (form === "graded") return fx("article-grades.html");
    const $ = cheerio.load(fx("article-grades.html"));
    if (form === "ungraded") $(".stadium_container_small .tags_info").empty();
    else $(".stadium_container_small").each((_, el) => { $(el).replaceWith(`<h3>${$(el).find("h3").first().text().trim()}</h3><br><h3></h3><br>`); });
    return $.html();
  };
  const storeWaiting = (id = 999001, publishedAt = new Date(NOW.getTime() - 60 * 60_000), url = REPORT_URL) => {
    const a = parseArticle(reportPage("waiting"), { id, url, headline: "BVB verspielt späte Zwei-Tore-Führung gegen Bremen", newsType: "sonstiges" }, "bundesliga", NOW);
    store.putArticle({ ...a, publishedAt: publishedAt.toISOString() });
  };
  const later = (min: number) => new Date(NOW.getTime() + min * 60_000);
  const readsOf = (calls: string[], url = REPORT_URL) => calls.filter((u) => u === url).length;

  it("a stored report waiting for its grades is read again from its own URL, and stored once the grades are in", async () => {
    storeWaiting();
    const { fetcher, calls } = fakeFetcher({ [REPORT_URL]: reportPage("graded") });
    const r = await run({ store, fetcher, publicDir, now: NOW });
    const a = store.getArticle(999001)!;
    expect(readsOf(calls)).toBe(1);
    expect(a.ratings?.[0]?.lines.flat()[0]?.player.grade).toBeTypeOf("number");
    expect(a.bodyHtml).not.toMatch(/Aufstellung von/);
    expect(a.ratings?.[0]?.lines.flat()[0]?.player.photo).toMatch(/^\/img\/players\//);
    expect(r.changed).toBe(true);
  });

  it("a re-read without grades changes nothing, and waits 30 minutes before the next", async () => {
    await run({ store, fetcher: fakeFetcher().fetcher, publicDir, now: NOW });
    storeWaiting();
    const first = fakeFetcher({ [REPORT_URL]: reportPage("waiting") });
    const r = await run({ store, fetcher: first.fetcher, publicDir, now: NOW });
    expect(readsOf(first.calls)).toBe(1);
    expect(store.getArticle(999001)!.ratings).toBeUndefined();
    expect(r.changed).toBe(false);
    expect(store.state().gradesTriedAt?.["999001"]).toBe(NOW.toISOString());
    const soon = fakeFetcher({ [REPORT_URL]: reportPage("waiting") });
    await run({ store, fetcher: soon.fetcher, publicDir, now: later(10) });
    expect(readsOf(soon.calls)).toBe(0);
    const half = fakeFetcher({ [REPORT_URL]: reportPage("waiting") });
    await run({ store, fetcher: half.fetcher, publicDir, now: later(31) });
    expect(readsOf(half.calls)).toBe(1);
  });

  it("a page whose grade pitches have no grade yet still counts as waiting (nothing stored)", async () => {
    storeWaiting();
    await run({ store, fetcher: fakeFetcher({ [REPORT_URL]: reportPage("ungraded") }).fetcher, publicDir, now: NOW });
    expect(store.getArticle(999001)!.ratings).toBeUndefined();
    expect(store.getArticle(999001)!.bodyHtml).toMatch(/Aufstellung von/);
  });

  it("after 3 days only the one first try (catch-up), never again", async () => {
    storeWaiting(999001, new Date(NOW.getTime() - 5 * 86_400_000));
    const first = fakeFetcher({ [REPORT_URL]: reportPage("waiting") });
    await run({ store, fetcher: first.fetcher, publicDir, now: NOW });
    expect(readsOf(first.calls)).toBe(1);
    const again = fakeFetcher({ [REPORT_URL]: reportPage("waiting") });
    await run({ store, fetcher: again.fetcher, publicDir, now: later(31) });
    expect(readsOf(again.calls)).toBe(0);
  });

  it("a newly stored waiting report isn't read again in the same half hour", async () => {
    const listed = "https://www.ligainsider.de/gregor-kobel_9357/kobel-kann-sich-langfristigen-bvb-verbleib-vorstellen-418778/";
    const first = fakeFetcher({ [listed]: reportPage("waiting") });
    await run({ store, fetcher: first.fetcher, publicDir, now: NOW });
    expect(store.state().gradesTriedAt?.["418778"]).toBe(NOW.toISOString());
    const soon = fakeFetcher({ [listed]: reportPage("waiting") });
    await run({ store, fetcher: soon.fetcher, publicDir, now: later(5) });
    expect(readsOf(soon.calls, listed)).toBe(0);
  });

  it("no reads for grades while LigaInsider's overview fails (its club list gives the reports' crests)", async () => {
    storeWaiting();
    const { fetcher, calls } = fakeFetcher({ [OVERVIEW]: 503, [REPORT_URL]: reportPage("graded") });
    await run({ store, fetcher, publicDir, now: NOW });
    expect(readsOf(calls)).toBe(0);
    expect(store.getArticle(999001)!.ratings).toBeUndefined();
  });

  it("at most 40 reads for grades per run", async () => {
    const url = (i: number) => `https://www.ligainsider.de/borussia-dortmund/14/bericht-${990000 + i}/`;
    for (let i = 0; i < 45; i++) storeWaiting(990000 + i, new Date(NOW.getTime() - 60 * 60_000), url(i));
    const overrides = Object.fromEntries(Array.from({ length: 45 }, (_, i) => [url(i), reportPage("waiting")]));
    const first = fakeFetcher(overrides);
    await run({ store, fetcher: first.fetcher, publicDir, now: NOW });
    expect(first.calls.filter((u) => u.includes("/bericht-")).length).toBe(40);
    const next = fakeFetcher(overrides);
    await run({ store, fetcher: next.fetcher, publicDir, now: later(5) });
    expect(next.calls.filter((u) => u.includes("/bericht-")).length).toBe(5);
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

  it("remembers listed articles that 404 and stops retrying them after an hour, without reporting a problem", async () => {
    const gone = "https://www.ligainsider.de/emre-can_1812/can-muss-sich-bis-ins-neue-jahr-gedulden-418776/";
    const first = await run({ store, fetcher: fakeFetcher({ [gone]: 404 }).fetcher, publicDir, now: NOW });
    expect(first.problems).toEqual([]);
    expect(store.getArticle(418776)).toBeUndefined();
    // Still gone an hour later: read once more in between, then left alone.
    await run({ store, fetcher: fakeFetcher({ [gone]: 404 }).fetcher, publicDir, now: new Date(NOW.getTime() + 30 * 60_000) });
    const { fetcher, calls } = fakeFetcher({ [gone]: 404 });
    const late = await run({ store, fetcher, publicDir, now: new Date(NOW.getTime() + 61 * 60_000) });
    expect(calls).not.toContain(gone);
    expect(late.problems).toEqual([]);
  });

  it("reads a listed article whose page 404ed at first again on the next run (LigaInsider lists it before the page is out)", async () => {
    const url = "https://www.ligainsider.de/emre-can_1812/can-muss-sich-bis-ins-neue-jahr-gedulden-418776/";
    await run({ store, fetcher: fakeFetcher({ [url]: 404 }).fetcher, publicDir, now: NOW });
    expect(store.getArticle(418776)).toBeUndefined();
    const res = await run({ store, fetcher: fakeFetcher().fetcher, publicDir, now: new Date(NOW.getTime() + 60_000) });
    expect(store.getArticle(418776)).toBeDefined();
    expect(res.newArticles).toBe(1);
    expect(store.state().unavailable?.[418776]).toBeUndefined();
  });

  it("reads an article whose page 404s once more in the same run after a pause", async () => {
    const url = "https://www.ligainsider.de/emre-can_1812/can-muss-sich-bis-ins-neue-jahr-gedulden-418776/";
    const { fetcher: base, calls } = fakeFetcher();
    let first = true;
    const fetcher: Fetcher = {
      ...base,
      async text(u) {
        if (u === url && first) { first = false; calls.push(u); throw new HttpError(404, u); }
        return base.text(u);
      },
    };
    const res = await run({ store, fetcher, publicDir, now: NOW, goneRetryMs: 1 });
    expect(calls.filter((c) => c === url)).toHaveLength(2);
    expect(store.getArticle(418776)).toBeDefined();
    expect(res.newArticles).toBeGreaterThan(0);
    expect(store.state().unavailable?.[418776]).toBeUndefined();
    expect(store.state().unavailableSince?.[418776]).toBeUndefined();
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

  it("is due when never fetched, then waits 30 minutes when no kickoff is near", () => {
    expect(lineupsDue([], undefined, NOW)).toBe(true);
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
