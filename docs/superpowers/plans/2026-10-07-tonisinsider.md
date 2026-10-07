# tonisInsider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A private, ad-free, fast and modern mirror of ligainsider.de's news feed and predicted Bundesliga XIs, refreshed every 5 minutes, for the owner and a few friends.

**Architecture:** A TypeScript scraper (cheerio) runs on a 5-minute GitHub Actions cron in a public, code-only repo. It keeps its data (`store/` JSON plus downloaded images) in the Actions cache. When content changed, it builds a static Astro + Tailwind site and deploys it to Cloudflare Pages with wrangler. If the cache is lost, the scraper restores itself from `/data/snapshot.json` on our own deployed site.

**Tech Stack:** Node 24, TypeScript 7 (run via `tsx`), cheerio 1.2, Vitest 5, Astro 7, Tailwind CSS 4 (`@tailwindcss/vite`), wrangler 4, GitHub Actions, Cloudflare Pages.

**Spec:** `docs/superpowers/specs/2026-10-07-tonisinsider-design.md`

**Provenance:** every code block in this plan was run in a prototype before the plan was written. The tests passed (53 tests) against real LigaInsider pages, a live scrape fetched 86 articles, 18 lineups and 264 photos, the Astro build produced 109 pages, and phone-size screenshots were checked in light and dark mode. Copy code verbatim. If something differs, the plan is wrong: stop and report.

## Global Constraints

- Language of all UI labels: German (News, Aufstellungen, Vereine, Alle, Bundesliga, Testspiele, Gesetzt, Fraglich, Stand).
- Scraped content (`store/`, `public/img/`, `public/data/`, `scraper/__fixtures__/`) is **never committed**: the repo is public. These paths are already in `.gitignore`.
- Request etiquette: one request at a time, ≥1 s between requests to ligainsider.de, 1 retry, 15 s timeout, Safari user-agent.
- Every page carries `<meta name="robots" content="noindex, nofollow">`; `robots.txt` disallows everything; `_headers` sends `X-Robots-Tag: noindex, nofollow`.
- Article bodies only contain the allowlist `p h3 b strong i em br a[href^=http]`, with links rendered as `target="_blank" rel="noopener noreferrer"`.
- Times are displayed in Europe/Berlin. Stored timestamps are ISO UTC.
- Retention: 30 days, measured by `publishedAt`, except articles LigaInsider still lists.
- Lineup cadence: every 30 min; every 10 min when any kickoff is within 48 h (and up to 3 h after it).
- Colours: iOS system palette (see `src/styles/global.css`); one accent green `#30d158` (dark) / `#248a3d` (light).
- Imports use explicit `.ts` extensions (`allowImportingTsExtensions`); the package is ESM (`"type": "module"`).
- The test fixtures are real LigaInsider pages in `scraper/__fixtures__/`. They are git-ignored, so **tests run locally, not in CI**. CI runs `npm run typecheck` on code pushes.

## Review Focus

1. **LigaInsider changes their HTML.** Expected: no broken pages are published, the last good data stays, and the job fails visibly. Pinned by `run.test.ts` "keeps the old article … fails validation" and "overview suddenly has no articles", plus `validate.test.ts`.
2. **An article is listed but its page 404s** (this happens in production: 2 of 88 on the first live run). Expected: it is skipped quietly and not retried every 5 minutes. Pinned by `run.test.ts` "remembers listed articles that 404".
3. **The Actions cache is evicted.** Expected: the store and images are restored from our own site instead of re-scraping LigaInsider. Pinned by `snapshot.test.ts` "round-trips the store through our own site".
4. **Daylight-saving time.** Expected: "09:32 Uhr" means Berlin time in both summer and winter, and day grouping uses Berlin midnight. Pinned by `text.test.ts` "converts Berlin wall-clock time … summer and winter" and `format.test.ts` "labels today and yesterday by Berlin calendar day".
5. **Hostile or odd markup in an article body** (scripts, `javascript:` links, inline handlers, ad slots). Expected: it is stripped or escaped and never rendered. Pinned by `sanitize.test.ts`.

## File Structure

```
package.json, tsconfig.json, astro.config.mjs, .gitignore, README.md
.github/workflows/scrape.yml      cron → restore → scrape → cache → build → deploy
scraper/
  types.ts                        shared data types (scraper and site)
  text.ts                         href/date/text helpers, BASE_URL
  sanitize.ts                     article body allowlist
  parse/newsList.ts               overview page → ArticleRef[]
  parse/article.ts                article page → Article
  parse/clubs.ts                  homepage nav → ClubRef[]
  parse/clubPage.ts               club page → Lineup
  validate.ts                     sanity checks before writing
  fetch.ts                        polite HTTP client (+ HttpError)
  store.ts                        JSON files in store/
  images.ts                       download each photo/crest once
  run.ts                          one scrape run (orchestration)
  snapshot.ts                     write snapshot / restore from site
  cli.ts                          scrape | restore | snapshot
  __fixtures__/*.html             real pages (git-ignored, already present)
  *.test.ts, parse/*.test.ts
src/
  styles/global.css               theme tokens (light/dark), Tailwind
  lib/format.ts (+ test)          Berlin-time formatting, initials
  lib/data.ts                     reads store/ at build time
  layouts/Base.astro              header, theme toggle, tab bar, footer
  components/Avatar.astro, StatusPill.astro, ArticleRow.astro,
             NewsFeed.astro, NewsTabs.astro, Pitch.astro, MatchHeader.astro
  pages/index.astro, news/[category].astro, artikel/[id].astro,
        aufstellungen.astro, vereine/index.astro, vereine/[slug].astro
public/robots.txt, public/_headers
```

---

### Task 1: Project scaffold, shared types and text helpers

**Files:**
- Create: `package.json`, `tsconfig.json`, `scraper/types.ts`, `scraper/text.ts`
- Test: `scraper/text.test.ts`
- Already present (git-ignored): `.gitignore`, `scraper/__fixtures__/*.html` (7 real pages captured on 2026-10-07)

**Interfaces:**
- Produces: all types in `scraper/types.ts` (`Ref`, `NewsType`, `Category`, `ArticleRef`, `Article`, `ClubRef`, `LineupPlayer`, `Lineup`, `State`). From `scraper/text.ts`: `BASE_URL`, `cleanText(s)`, `parsePlayerHref(href)`, `parseClubHref(href)`, `parseArticleId(href)`, `berlinToIso(y,m,d,h,mi)`, `parseGermanDateTime(text)`, `absoluteUrl(href)`.

- [ ] **Step 1: Create package.json and install dependencies**

`package.json`:

````json
{
  "name": "tonisinsider",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "scrape": "tsx scraper/cli.ts scrape",
    "restore": "tsx scraper/cli.ts restore",
    "dev": "astro dev",
    "build": "tsx scraper/cli.ts snapshot && astro build",
    "preview": "astro preview",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  }
}
````

Run:
```bash
npm i cheerio@^1.2.0 astro@^7.3.6 tailwindcss@^4.3.3 @tailwindcss/vite@^4.3.3 tsx@^4.23.15
npm i -D typescript@^7.0.2 vitest@^5.0.3 @types/node@^26.6.4 wrangler@^4.148.0
```
Expected: installs without errors; `package-lock.json` is created.

- [ ] **Step 2: Create tsconfig.json and the shared types**

`tsconfig.json`:

````json
{
  "extends": "astro/tsconfigs/strict",
  "compilerOptions": {
    "allowImportingTsExtensions": true,
    "types": ["node"]
  },
  "include": [".astro/types.d.ts", "**/*"],
  "exclude": ["dist", "store", "public"]
}
````

`scraper/types.ts`:

````ts
export type Ref = { id: number; slug: string; name: string };

export type NewsType = "verletzung" | "angeschlagen" | "aufbautraining" | "fit" | "sonstiges";

export type Category = "bundesliga" | "testspiele";

export type ArticleRef = {
  id: number;
  url: string;
  headline: string;
  newsType: NewsType;
  playerPhotoUrl?: string;
};

export type Article = {
  id: number;
  url: string;
  headline: string;
  listHeadline: string; // headline as shown in the overview; a change triggers a re-fetch
  category: Category;
  newsType: NewsType;
  player?: Ref & { photo?: string };
  club?: Ref & { crest?: string };
  author?: string;
  source?: { name: string; url?: string };
  publishedAt: string;
  bodyHtml: string;
  fetchedAt: string;
};

export type ClubRef = Ref & { crestUrl: string };

export type LineupPlayer = Ref & {
  photo?: string;
  photoUrl?: string;
  status: "set" | "doubtful";
  statusLabel?: string;
  alternative?: Ref & { photo?: string; photoUrl?: string };
};

export type Lineup = {
  club: Ref & { crest?: string };
  opponent?: { name: string; home: boolean };
  matchday?: number;
  kickoff?: string;
  formation: string;
  lines: LineupPlayer[][];
  updatedAt: string;
};

export type State = {
  lineupsFetchedAt?: string;
  lastChangeAt?: string;
  /** Articles that are listed but 404 on LigaInsider: id → list headline. Skipped until the headline changes. */
  unavailable?: Record<string, string>;
};
````


- [ ] **Step 3: Write the failing test**

`scraper/text.test.ts`:

````ts
import { describe, it, expect } from "vitest";
import { berlinToIso, cleanText, parseArticleId, parseClubHref, parseGermanDateTime, parsePlayerHref } from "./text.ts";

describe("text helpers", () => {
  it("removes soft hyphens and collapses whitespace", () => {
    expect(cleanText("  Kobel kann sich langfris­ti­gen\n  BVB-Verbleib ")).toBe("Kobel kann sich langfristigen BVB-Verbleib");
  });

  it("parses player, club and article hrefs", () => {
    expect(parsePlayerHref("/gregor-kobel_9357/")).toEqual({ slug: "gregor-kobel", id: 9357 });
    expect(parsePlayerHref("/borussia-dortmund/14/")).toBeUndefined();
    expect(parseClubHref("/borussia-dortmund/14/")).toEqual({ slug: "borussia-dortmund", id: 14 });
    expect(parseArticleId("/gregor-kobel_9357/kobel-kann-sich-langfristigen-bvb-verbleib-vorstellen-418778/")).toBe(418778);
    expect(parseArticleId("/deutschland-u21/33166/em-quali-fix-deutschlands-u21-besiegt-georgien-418765/")).toBe(418765);
    expect(parseArticleId("/borussia-dortmund/14/")).toBeUndefined();
  });

  it("converts Berlin wall-clock time to UTC in summer and winter", () => {
    expect(berlinToIso(2026, 10, 7, 9, 32)).toBe("2026-10-07T07:32:00.000Z");
    expect(berlinToIso(2026, 12, 5, 15, 30)).toBe("2026-12-05T14:30:00.000Z");
  });

  it("parses both German date formats used by LigaInsider", () => {
    expect(parseGermanDateTime("07.10.2026 - 09:32 Uhr")).toBe("2026-10-07T07:32:00.000Z");
    expect(parseGermanDateTime("Heimspiel Fr. 09.10.2026 | 20:30 gegen")).toBe("2026-10-09T18:30:00.000Z");
    expect(parseGermanDateTime("kein Datum")).toBeUndefined();
  });
});
````


- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run scraper/text.test.ts`
Expected: FAIL, cannot find module `./text.ts`.

- [ ] **Step 5: Implement**

`scraper/text.ts`:

````ts
export const BASE_URL = "https://www.ligainsider.de";

/** Collapse whitespace and remove soft hyphens (&shy;). */
export function cleanText(s: string): string {
  return s.replace(/­/g, "").replace(/\s+/g, " ").trim();
}

/** "/gregor-kobel_9357/" → { slug: "gregor-kobel", id: 9357 } */
export function parsePlayerHref(href: string): { slug: string; id: number } | undefined {
  const m = href.match(/^\/([a-z0-9-]+)_(\d+)\/$/i);
  return m ? { slug: m[1], id: Number(m[2]) } : undefined;
}

/** "/borussia-dortmund/14/" → { slug: "borussia-dortmund", id: 14 } */
export function parseClubHref(href: string): { slug: string; id: number } | undefined {
  const m = href.match(/^\/([a-z0-9-]+)\/(\d+)\/$/i);
  return m ? { slug: m[1], id: Number(m[2]) } : undefined;
}

/** "/gregor-kobel_9357/kobel-kann-...-418778/" → 418778 */
export function parseArticleId(href: string): number | undefined {
  const m = href.match(/^\/[a-z0-9-]+_\d+\/[a-z0-9-]+-(\d+)\/$/i)
    ?? href.match(/^\/[a-z0-9-]+\/\d+\/[a-z0-9-]+-(\d+)\/$/i);
  return m ? Number(m[1]) : undefined;
}

/** UTC offset of Europe/Berlin at the given instant, in minutes (60 or 120). */
function berlinOffsetMinutes(utc: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Berlin", hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(utc);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  return Math.round((asUtc - utc.getTime()) / 60000);
}

/** Berlin wall-clock time → ISO string in UTC. */
export function berlinToIso(year: number, month: number, day: number, hour: number, minute: number): string {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const offset = berlinOffsetMinutes(new Date(guess.getTime() - 60 * 60000));
  return new Date(guess.getTime() - offset * 60000).toISOString();
}

/** Finds "DD.MM.YYYY" followed by "HH:MM" anywhere in the text, e.g. "07.10.2026 - 09:32 Uhr" or "Fr. 09.10.2026 | 20:30". */
export function parseGermanDateTime(text: string): string | undefined {
  const m = text.match(/(\d{2})\.(\d{2})\.(\d{4})\D{1,10}?(\d{2}):(\d{2})/);
  if (!m) return undefined;
  const [, d, mo, y, h, mi] = m.map(Number);
  return berlinToIso(y, mo, d, h, mi);
}

export function absoluteUrl(href: string): string {
  return new URL(href, BASE_URL).toString();
}
````


- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run scraper/text.test.ts` → PASS (4 tests). Run: `npx tsc --noEmit` → no output.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.json .gitignore scraper/types.ts scraper/text.ts scraper/text.test.ts
git commit -m "feat: scaffold project, shared types and text helpers"
```


### Task 2: Article body sanitiser

**Files:**
- Create: `scraper/sanitize.ts`
- Test: `scraper/sanitize.test.ts`

**Interfaces:**
- Produces: `sanitizeBody(html: string): string`. Keeps `p h3 b strong i em br` and `a` with http(s) `href` only; drops `script style iframe img noscript svg form button` and `div#ad_oop` with their content; unwraps everything else; escapes text.


- [ ] **Step 1: Write the failing test**

`scraper/sanitize.test.ts`:

````ts
import { describe, it, expect } from "vitest";
import { sanitizeBody } from "./sanitize.ts";

describe("sanitizeBody", () => {
  it("keeps allowed formatting", () => {
    expect(sanitizeBody("<p>Laut <i>Sport Bild</i> <b>live</b></p><h3>Termine</h3>"))
      .toBe("<p>Laut <i>Sport Bild</i> <b>live</b></p><h3>Termine</h3>");
  });

  it("removes ad containers, scripts, images and unknown attributes", () => {
    const html = `<p class="x" style="color:red">A</p><div id="ad_oop"><span>AD</span></div><script>alert(1)</script><img src="x.jpg"><p onclick="x()">B</p>`;
    expect(sanitizeBody(html)).toBe("<p>A</p><p>B</p>");
  });

  it("unwraps unknown tags but keeps their text", () => {
    expect(sanitizeBody("<p><span>Hallo <u>Welt</u></span></p>")).toBe("<p>Hallo Welt</p>");
  });

  it("keeps external links (opening in a new tab) and unwraps relative or javascript links", () => {
    expect(sanitizeBody(`<p><a class="online" href="https://youtube.com/x" target="_b">YouTube</a></p>`))
      .toBe(`<p><a href="https://youtube.com/x" target="_blank" rel="noopener noreferrer">YouTube</a></p>`);
    expect(sanitizeBody(`<p><a href="/spieler_1/">Spieler</a> <a href="javascript:alert(1)">x</a></p>`))
      .toBe("<p>Spieler x</p>");
  });

  it("escapes text so it cannot inject markup", () => {
    expect(sanitizeBody("<p>1 &lt; 2 &amp; &lt;script&gt;</p>")).toBe("<p>1 &lt; 2 &amp; &lt;script&gt;</p>");
  });

  it("drops empty paragraphs and collapses long runs of line breaks", () => {
    expect(sanitizeBody("<p>A<br><br><br><br>B</p><p> <br> </p>")).toBe("<p>A<br><br>B</p>");
  });
});
````

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scraper/sanitize.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`scraper/sanitize.ts`:

````ts
import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";

const ALLOWED = new Set(["p", "h3", "b", "strong", "i", "em", "br", "a"]);
const DROP_WITH_CONTENT = new Set(["script", "style", "iframe", "img", "noscript", "svg", "form", "button"]);

function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return escapeText(s).replace(/"/g, "&quot;");
}

function render(nodes: AnyNode[]): string {
  let out = "";
  for (const node of nodes) {
    if (node.type === "text") {
      out += escapeText(node.data.replace(/­/g, ""));
    } else if (node.type === "tag") {
      const tag = node.name.toLowerCase();
      if (DROP_WITH_CONTENT.has(tag)) continue;
      if (tag === "div" && node.attribs.id === "ad_oop") continue;
      const inner = render(node.children);
      if (!ALLOWED.has(tag)) { out += inner; continue; }
      if (tag === "br") { out += "<br>"; continue; }
      if (tag === "a") {
        const href = node.attribs.href ?? "";
        out += /^https?:\/\//i.test(href)
          ? `<a href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer">${inner}</a>`
          : inner;
        continue;
      }
      out += `<${tag}>${inner}</${tag}>`;
    }
  }
  return out;
}

/** Reduces article body HTML to a small allowlist of tags. Everything else is unwrapped or dropped. */
export function sanitizeBody(html: string): string {
  const $ = cheerio.load(html, null, false);
  return render($.root().contents().toArray())
    .replace(/(<br>\s*){3,}/g, "<br><br>")
    .replace(/<p>(\s|<br>)*<\/p>/g, "")
    .trim();
}
````

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run scraper/sanitize.test.ts` → PASS (6 tests). Run: `npx tsc --noEmit` → no output.

- [ ] **Step 5: Commit**

```bash
git add scraper/sanitize.ts scraper/sanitize.test.ts
git commit -m "feat: sanitise article bodies to a tag allowlist"
```


### Task 3: News overview parser

**Files:**
- Create: `scraper/parse/newsList.ts`
- Test: `scraper/parse/newsList.test.ts`

**Interfaces:**
- Consumes: `ArticleRef`, `NewsType` (types.ts); `absoluteUrl`, `cleanText`, `parseArticleId` (text.ts).
- Produces: `parseNewsList(html): ArticleRef[]` (deduplicated, page order) and `newsTypeFromLabel(label?): NewsType`.


Markup facts (verified): each entry is a `.feature_column`; the headline is `a.newsboxlink h3`; the type icon is `.social_left_icon img[alt]` (Verletzung/Angeschlagen/Aufbautraining/Fit/Sonstiges …); the photo is `.player_photo img`. 15 entries per page.

- [ ] **Step 1: Write the failing test**

`scraper/parse/newsList.test.ts`:

````ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseNewsList, newsTypeFromLabel } from "./newsList.ts";

const fx = (name: string) => readFileSync(join(import.meta.dirname, "..", "__fixtures__", name), "utf8");

describe("parseNewsList", () => {
  it("parses all 15 entries of the Bundesliga overview", () => {
    const refs = parseNewsList(fx("news-bundesliga.html"));
    expect(refs).toHaveLength(15);
    expect(new Set(refs.map((r) => r.id)).size).toBe(15);
  });

  it("extracts id, absolute url, clean headline, news type and photo", () => {
    const refs = parseNewsList(fx("news-bundesliga.html"));
    expect(refs.find((r) => r.id === 418778)).toEqual({
      id: 418778,
      url: "https://www.ligainsider.de/gregor-kobel_9357/kobel-kann-sich-langfristigen-bvb-verbleib-vorstellen-418778/",
      headline: "Kobel kann sich langfristigen BVB-Verbleib vorstellen",
      newsType: "sonstiges",
      playerPhotoUrl: "https://cdn.ligainsider.de/images/player/team/minor/gregor-kobel-dortmund-2627.jpg",
    });
    expect(refs.find((r) => r.id === 418776)?.newsType).toBe("verletzung");
    expect(refs.find((r) => r.id === 418777)?.newsType).toBe("fit");
  });

  it("parses the Testspiele overview", () => {
    expect(parseNewsList(fx("news-testspiele.html"))).toHaveLength(15);
  });

  it("returns an empty list for unrelated HTML", () => {
    expect(parseNewsList("<html><body><p>Wartung</p></body></html>")).toEqual([]);
  });

  it("maps unknown icon labels to sonstiges", () => {
    expect(newsTypeFromLabel("Sonstiges / Interview / Persönliches")).toBe("sonstiges");
    expect(newsTypeFromLabel(undefined)).toBe("sonstiges");
    expect(newsTypeFromLabel("Aufbautraining")).toBe("aufbautraining");
  });
});
````

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scraper/parse/newsList.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`scraper/parse/newsList.ts`:

````ts
import * as cheerio from "cheerio";
import type { ArticleRef, NewsType } from "../types.ts";
import { absoluteUrl, cleanText, parseArticleId } from "../text.ts";

const NEWS_TYPES: Record<string, NewsType> = {
  "verletzung": "verletzung",
  "angeschlagen": "angeschlagen",
  "aufbautraining": "aufbautraining",
  "fit": "fit",
};

export function newsTypeFromLabel(label: string | undefined): NewsType {
  const key = (label ?? "").trim().toLowerCase();
  return NEWS_TYPES[key] ?? "sonstiges";
}

/** Parses a LigaInsider news overview page (startpage or testspiele-news). */
export function parseNewsList(html: string): ArticleRef[] {
  const $ = cheerio.load(html);
  const refs: ArticleRef[] = [];
  const seen = new Set<number>();
  $(".feature_column").each((_, el) => {
    const col = $(el);
    const link = col.find("a.newsboxlink").first();
    const href = link.attr("href");
    if (!href) return;
    const id = parseArticleId(href);
    if (id === undefined || seen.has(id)) return;
    seen.add(id);
    const photo = col.find(".player_photo img").first().attr("src");
    refs.push({
      id,
      url: absoluteUrl(href),
      headline: cleanText(link.find("h3").text()),
      newsType: newsTypeFromLabel(col.find(".social_left_icon img").first().attr("alt")),
      playerPhotoUrl: photo || undefined,
    });
  });
  return refs;
}
````

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run scraper/parse/newsList.test.ts` → PASS (5 tests). Run: `npx tsc --noEmit` → no output.

- [ ] **Step 5: Commit**

```bash
git add scraper/parse/newsList.ts scraper/parse/newsList.test.ts
git commit -m "feat: parse LigaInsider news overview pages"
```


### Task 4: Article page parser

**Files:**
- Create: `scraper/parse/article.ts`
- Test: `scraper/parse/article.test.ts`

**Interfaces:**
- Consumes: `sanitizeBody` (Task 2); `cleanText`, `parseClubHref`, `parseGermanDateTime`, `parsePlayerHref` (Task 1).
- Produces: `parseArticle(html, ref: ArticleRef, category: Category, now: Date): Article`. Never throws on unexpected HTML; returns empty `bodyHtml`/`publishedAt`, which validation (Task 6) rejects.


Markup facts (verified): headline `h1[itemprop=name]`; player and club are the links in `.news_title_box strong` (editorial pieces use `/ligainsider_1381/`, which is not a player); date `.news_banner_info span.float-start` ("07.10.2026 - 09:32 Uhr"); author `.autor_melder`; body `[itemprop=articleBody]` (contains `<div id="ad_oop">`); source `.quelle a`.

- [ ] **Step 1: Write the failing test**

`scraper/parse/article.test.ts`:

````ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArticle } from "./article.ts";
import type { ArticleRef } from "../types.ts";

const fx = (name: string) => readFileSync(join(import.meta.dirname, "..", "__fixtures__", name), "utf8");
const NOW = new Date("2026-10-07T09:00:00Z");
const ref = (id: number, headline = "List headline"): ArticleRef => ({
  id, url: `https://www.ligainsider.de/x_1/y-${id}/`, headline, newsType: "verletzung",
});

describe("parseArticle", () => {
  it("parses a player article", () => {
    const a = parseArticle(fx("article-kobel.html"), ref(418778), "bundesliga", NOW);
    expect(a.headline).toBe("Kobel kann sich langfristigen BVB-Verbleib vorstellen");
    expect(a.listHeadline).toBe("List headline");
    expect(a.player).toEqual({ id: 9357, slug: "gregor-kobel", name: "Gregor Kobel" });
    expect(a.club).toEqual({ id: 14, slug: "borussia-dortmund", name: "Borussia Dortmund" });
    expect(a.author).toBe("Robin Meise");
    expect(a.publishedAt).toBe("2026-10-07T07:32:00.000Z");
    expect(a.source?.name).toBe("bild.de");
    expect(a.source?.url).toMatch(/^https:\/\/www\.bild\.de\//);
    expect(a.newsType).toBe("verletzung");
    expect(a.category).toBe("bundesliga");
    expect(a.fetchedAt).toBe(NOW.toISOString());
  });

  it("keeps the full body with formatting but without the ad slot", () => {
    const a = parseArticle(fx("article-kobel.html"), ref(418778), "bundesliga", NOW);
    expect(a.bodyHtml.startsWith("<p>Gregor Kobel kann sich gut vorstellen")).toBe(true);
    expect(a.bodyHtml).toContain("<i>Sport Bild</i>");
    expect(a.bodyHtml).toContain("Waldemar Anton und Julian Ryerson");
    expect(a.bodyHtml).not.toContain("ad_oop");
    expect(a.bodyHtml).not.toContain("DURCHSCHNITTSNOTE");
    expect(a.bodyHtml.match(/<p>/g)).toHaveLength(4);
  });

  it("does not treat the LigaInsider editorial account as a player", () => {
    const a = parseArticle(fx("article-pk-termine.html"), ref(418731), "bundesliga", NOW);
    expect(a.headline).toBe("5. Spieltag: Die PK-Termine in der Übersicht");
    expect(a.player).toBeUndefined();
    expect(a.club).toBeUndefined();
    expect(a.bodyHtml).toContain("<h3>Die PK-Termine in der Übersicht</h3>");
    expect(a.bodyHtml).toContain('<a href="https://www.youtube.com/');
  });

  it("returns an empty body and date for a page that is not an article (validation catches it)", () => {
    const a = parseArticle("<html><body>Wartung</body></html>", ref(1, "X"), "bundesliga", NOW);
    expect(a.bodyHtml).toBe("");
    expect(a.publishedAt).toBe("");
    expect(a.headline).toBe("X");
  });
});
````

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scraper/parse/article.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`scraper/parse/article.ts`:

````ts
import * as cheerio from "cheerio";
import type { Article, ArticleRef, Category } from "../types.ts";
import { cleanText, parseClubHref, parseGermanDateTime, parsePlayerHref } from "../text.ts";
import { sanitizeBody } from "../sanitize.ts";

/** Slugs that look like players in URLs but are editorial accounts. */
const NON_PLAYER_SLUGS = new Set(["ligainsider"]);

export function parseArticle(html: string, ref: ArticleRef, category: Category, now: Date): Article {
  const $ = cheerio.load(html);
  const titleBox = $(".news_title_box").first();

  let player: Article["player"];
  let club: Article["club"];
  titleBox.find("strong a").each((_, a) => {
    const href = $(a).attr("href") ?? "";
    const name = cleanText($(a).text());
    const p = parsePlayerHref(href);
    if (p && !NON_PLAYER_SLUGS.has(p.slug) && !player) { player = { ...p, name }; return; }
    const c = parseClubHref(href);
    if (c && !club) club = { ...c, name };
  });

  const headline = cleanText($("h1[itemprop=name]").first().text()) || cleanText(titleBox.find("h2").text()) || ref.headline;
  const info = $(".news_banner_info").first();
  const publishedAt = parseGermanDateTime(info.find("span.float-start").first().text()) ?? "";
  const authorText = cleanText(info.find(".autor_melder").text());
  const author = authorText.match(/Autor:\s*(.+)$/)?.[1]?.trim()
    ?? authorText.match(/Gemeldet von:\s*(.+?)(\||$)/)?.[1]?.trim();

  const sourceLink = $(".quelle a").first();
  const sourceHref = sourceLink.attr("href") ?? "";
  const source = sourceLink.length
    ? { name: cleanText(sourceLink.text()), url: /^https?:\/\//i.test(sourceHref) ? sourceHref : undefined }
    : undefined;

  const bodyHtml = sanitizeBody($("[itemprop=articleBody]").first().html() ?? "");

  return {
    id: ref.id,
    url: ref.url,
    headline,
    listHeadline: ref.headline,
    category,
    newsType: ref.newsType,
    player,
    club,
    author: author || undefined,
    source,
    publishedAt,
    bodyHtml,
    fetchedAt: now.toISOString(),
  };
}
````

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run scraper/parse/article.test.ts` → PASS (4 tests). Run: `npx tsc --noEmit` → no output.

- [ ] **Step 5: Commit**

```bash
git add scraper/parse/article.ts scraper/parse/article.test.ts
git commit -m "feat: parse LigaInsider article pages"
```


### Task 5: Club list and predicted-XI parsers

**Files:**
- Create: `scraper/parse/clubs.ts`, `scraper/parse/clubPage.ts`
- Test: `scraper/parse/clubs.test.ts`, `scraper/parse/clubPage.test.ts`

**Interfaces:**
- Consumes: `ClubRef`, `Lineup`, `LineupPlayer`, `Ref` (types.ts); `cleanText`, `parseGermanDateTime`, `parsePlayerHref` (text.ts).
- Produces: `parseClubs(html): ClubRef[]` (from the homepage/Bundesliga overview nav, 18 clubs) and `parseClubPage(html, club: ClubRef, now: Date): Lineup`. `lines[0]` is the goalkeeper; `formation` is the outfield row sizes joined by "-".

Markup facts (verified): rows are `.stadium_container_bg .player_position_row`, players are its `.player_position_column` children. A column with two `.sub_child` holds the predicted player plus an alternative. A status icon is `.bottom_icon img[alt]` (e.g. "Angeschlagen"), and its presence means doubtful. The match line is `.team_box_right p` ("Heimspiel Fr. 09.10.2026 | 20:30 gegen <strong>SV Werder Bremen</strong>"). The matchday is `select.day_select option[selected]` ("5.").

- [ ] **Step 1: Write the failing tests**

`scraper/parse/clubs.test.ts`:

````ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseClubs } from "./clubs.ts";

const fx = (name: string) => readFileSync(join(import.meta.dirname, "..", "__fixtures__", name), "utf8");

describe("parseClubs", () => {
  it("finds all 18 Bundesliga clubs with name and crest", () => {
    const clubs = parseClubs(fx("news-bundesliga.html"));
    expect(clubs).toHaveLength(18);
    expect(clubs.find((c) => c.id === 14)).toEqual({
      id: 14,
      slug: "borussia-dortmund",
      name: "Borussia Dortmund",
      crestUrl: "https://cdn.ligainsider.de/images/teams/small/borussia-dortmund-wappen.png",
    });
  });
});
````

`scraper/parse/clubPage.test.ts`:

````ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseClubPage } from "./clubPage.ts";

const fx = (name: string) => readFileSync(join(import.meta.dirname, "..", "__fixtures__", name), "utf8");
const NOW = new Date("2026-10-07T09:00:00Z");
const BVB = { id: 14, slug: "borussia-dortmund", name: "Borussia Dortmund", crestUrl: "" };
const TSG = { id: 10, slug: "tsg-hoffenheim", name: "TSG Hoffenheim", crestUrl: "" };

describe("parseClubPage", () => {
  it("parses BVB's predicted XI line by line", () => {
    const l = parseClubPage(fx("club-bvb.html"), BVB, NOW);
    expect(l.lines.map((line) => line.map((p) => p.name))).toEqual([
      ["Kobel"],
      ["Gadou", "Anton", "N. Schlotterbeck"],
      ["Beier", "Veerman", "F. Nmecha", "Svensson"],
      ["Karetsas", "Guirassy", "Silva"],
    ]);
    expect(l.formation).toBe("3-4-3");
    expect(l.club).toEqual({ id: 14, slug: "borussia-dortmund", name: "Borussia Dortmund" });
    expect(l.updatedAt).toBe(NOW.toISOString());
  });

  it("reads the match: opponent, home/away, matchday, kickoff", () => {
    const l = parseClubPage(fx("club-bvb.html"), BVB, NOW);
    expect(l.opponent).toEqual({ name: "SV Werder Bremen", home: true });
    expect(l.matchday).toBe(5);
    expect(l.kickoff).toBe("2026-10-09T18:30:00.000Z");
  });

  it("marks doubtful players with label and alternative", () => {
    const l = parseClubPage(fx("club-bvb.html"), BVB, NOW);
    const schlotterbeck = l.lines[1][2];
    expect(schlotterbeck).toMatchObject({
      id: 20052, slug: "nico-schlotterbeck", status: "doubtful", statusLabel: "Angeschlagen",
      photoUrl: "https://cdn.ligainsider.de/images/player/team/minor/nico-schlotterbeck-dortmund-2627.jpg",
    });
    expect(schlotterbeck.alternative).toMatchObject({ id: 7791, name: "Bensebaini" });
    expect(l.lines[0][0]).toMatchObject({ name: "Kobel", status: "set", alternative: undefined });
  });

  it("keeps an alternative even when the player has no status icon", () => {
    const l = parseClubPage(fx("club-tsg.html"), TSG, NOW);
    expect(l.formation).toBe("4-4-2");
    const conte = l.lines[2][0];
    expect(conte.status).toBe("set");
    expect(conte.alternative?.name).toBe("Kramarić");
  });

  it("returns no lines for a page without a lineup (validation catches it)", () => {
    const l = parseClubPage("<html></html>", BVB, NOW);
    expect(l.lines).toEqual([]);
    expect(l.formation).toBe("");
  });
});
````


- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run scraper/parse/clubs.test.ts scraper/parse/clubPage.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

`scraper/parse/clubs.ts`:

````ts
import * as cheerio from "cheerio";
import type { ClubRef } from "../types.ts";
import { cleanText } from "../text.ts";

/** Finds the Bundesliga clubs via the homepage navigation (links to /<slug>/<id>/verein/news/). */
export function parseClubs(html: string): ClubRef[] {
  const $ = cheerio.load(html);
  const ids = new Map<number, string>();
  $("a[href]").each((_, a) => {
    const m = ($(a).attr("href") ?? "").match(/^\/([a-z0-9-]+)\/(\d+)\/verein\/news\/$/);
    if (m) ids.set(Number(m[2]), m[1]);
  });
  const clubs: ClubRef[] = [];
  for (const [id, slug] of ids) {
    const img = $(`a[href="/${slug}/${id}/"] img[alt]`).first();
    clubs.push({
      id,
      slug,
      name: cleanText(img.attr("alt") ?? slug),
      crestUrl: img.attr("src") ?? "",
    });
  }
  return clubs;
}
````

`scraper/parse/clubPage.ts`:

````ts
import * as cheerio from "cheerio";
import type { Cheerio } from "cheerio";
import type { Element } from "domhandler";
import type { ClubRef, Lineup, LineupPlayer, Ref } from "../types.ts";
import { cleanText, parseGermanDateTime, parsePlayerHref } from "../text.ts";

type PlayerBits = Ref & { photoUrl?: string; statusLabel?: string };

function readPlayer(box: Cheerio<Element>): PlayerBits | undefined {
  const link = box.find(".player_name a").first();
  const ref = parsePlayerHref(link.attr("href") ?? "");
  if (!ref) return undefined;
  const statusLabel = box.find(".bottom_icon img[alt]").first().attr("alt")?.trim();
  return {
    ...ref,
    name: cleanText(link.text()),
    photoUrl: box.find(".player_position_photo img").first().attr("src") || undefined,
    statusLabel: statusLabel || undefined,
  };
}

/** Parses the predicted XI ("Voraussichtliche Aufstellung") from a club page. */
export function parseClubPage(html: string, club: ClubRef, now: Date): Lineup {
  const $ = cheerio.load(html);
  const lines: LineupPlayer[][] = [];

  $(".stadium_container_bg .player_position_row").each((_, row) => {
    const line: LineupPlayer[] = [];
    $(row).children(".player_position_column").each((_, col) => {
      const subs = $(col).children(".sub_child");
      const main = readPlayer(subs.length ? subs.eq(0) : $(col));
      if (!main) return;
      const alt = subs.length > 1 ? readPlayer(subs.eq(1)) : undefined;
      line.push({
        id: main.id, slug: main.slug, name: main.name,
        photoUrl: main.photoUrl,
        status: main.statusLabel ? "doubtful" : "set",
        statusLabel: main.statusLabel,
        alternative: alt ? { id: alt.id, slug: alt.slug, name: alt.name, photoUrl: alt.photoUrl } : undefined,
      });
    });
    if (line.length) lines.push(line);
  });

  const matchText = cleanText($(".team_box_right p").first().text());
  const opponentName = cleanText($(".team_box_right p strong").first().text());
  const matchdayText = cleanText($("select.day_select option[selected]").first().text());
  const matchday = Number(matchdayText.replace(/\D/g, "")) || undefined;

  return {
    club: { id: club.id, slug: club.slug, name: cleanText($("h2[itemprop=name]").first().text()) || club.name },
    opponent: opponentName ? { name: opponentName, home: /Heimspiel/i.test(matchText) } : undefined,
    matchday,
    kickoff: parseGermanDateTime(matchText),
    formation: lines.slice(1).map((l) => l.length).join("-"),
    lines,
    updatedAt: now.toISOString(),
  };
}
````


- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run scraper/parse` → PASS (all parser tests, 15 in total). Run: `npx tsc --noEmit` → no output.

- [ ] **Step 5: Commit**

```bash
git add scraper/parse/clubs.ts scraper/parse/clubPage.ts scraper/parse/clubs.test.ts scraper/parse/clubPage.test.ts
git commit -m "feat: parse club list and predicted XIs"
```


### Task 6: Validation

**Files:**
- Create: `scraper/validate.ts`
- Test: `scraper/validate.test.ts`

**Interfaces:**
- Produces: `validateArticle(a: Article): string[]` and `validateLineup(l: Lineup): string[]`. An empty array means OK; the strings are used verbatim in problem reports.


- [ ] **Step 1: Write the failing test**

`scraper/validate.test.ts`:

````ts
import { describe, it, expect } from "vitest";
import { validateArticle, validateLineup } from "./validate.ts";
import type { Article, Lineup, LineupPlayer } from "./types.ts";

const article: Article = {
  id: 1, url: "u", headline: "H", listHeadline: "H", category: "bundesliga", newsType: "fit",
  publishedAt: "2026-10-07T07:32:00.000Z", bodyHtml: "<p>Ein ausreichend langer Text.</p>", fetchedAt: "x",
};
const player = (id: number): LineupPlayer => ({ id, slug: `p${id}`, name: `P${id}`, status: "set" });
const lineup = (sizes: number[]): Lineup => {
  let id = 0;
  return {
    club: { id: 14, slug: "bvb", name: "BVB" }, formation: "", updatedAt: "x",
    lines: sizes.map((n) => Array.from({ length: n }, () => player(++id))),
  };
};

describe("validateArticle", () => {
  it("accepts a complete article", () => expect(validateArticle(article)).toEqual([]));
  it("rejects missing headline, bad date and empty body", () => {
    expect(validateArticle({ ...article, headline: "", publishedAt: "", bodyHtml: "<p> </p>" })).toEqual([
      "missing headline", "missing or invalid publishedAt", "body too short",
    ]);
  });
});

describe("validateLineup", () => {
  it("accepts 1 + 10 players", () => expect(validateLineup(lineup([1, 4, 4, 2]))).toEqual([]));
  it("rejects 10 players", () => expect(validateLineup(lineup([1, 4, 4, 1]))).toEqual(["expected 11 players, got 10"]));
  it("rejects two goalkeepers in the first line", () => {
    expect(validateLineup(lineup([2, 4, 3, 2]))).toEqual(["first line must be exactly one goalkeeper"]);
  });
});
````

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scraper/validate.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`scraper/validate.ts`:

````ts
import type { Article, Lineup } from "./types.ts";

/** Returns a list of problems; empty means the article is safe to publish. */
export function validateArticle(a: Article): string[] {
  const problems: string[] = [];
  if (!Number.isInteger(a.id) || a.id <= 0) problems.push("invalid id");
  if (!a.headline) problems.push("missing headline");
  if (!a.publishedAt || Number.isNaN(Date.parse(a.publishedAt))) problems.push("missing or invalid publishedAt");
  if (a.bodyHtml.replace(/<[^>]+>/g, "").trim().length < 20) problems.push("body too short");
  return problems;
}

/** Returns a list of problems; empty means the lineup is safe to publish. */
export function validateLineup(l: Lineup): string[] {
  const problems: string[] = [];
  const count = l.lines.reduce((n, line) => n + line.length, 0);
  if (count !== 11) problems.push(`expected 11 players, got ${count}`);
  if (l.lines[0]?.length !== 1) problems.push("first line must be exactly one goalkeeper");
  if (!l.club.name) problems.push("missing club name");
  return problems;
}
````

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run scraper/validate.test.ts` → PASS (5 tests). Run: `npx tsc --noEmit` → no output.

- [ ] **Step 5: Commit**

```bash
git add scraper/validate.ts scraper/validate.test.ts
git commit -m "feat: validate articles and lineups before publishing"
```


### Task 7: HTTP client, file store and image cache

**Files:**
- Create: `scraper/fetch.ts`, `scraper/store.ts`, `scraper/images.ts`
- Test: `scraper/store.test.ts`, `scraper/images.test.ts`

**Interfaces:**
- Produces:
  - `fetch.ts`: `class HttpError extends Error { status: number }`; `type Fetcher = { text(url): Promise<string>; binary(url): Promise<Uint8Array> }`; `createFetcher(opts?: { delayMs?: number; timeoutMs?: number }): Fetcher` (default 1000 ms delay, 15 s timeout, 1 retry, no retry on 404).
  - `store.ts`: `class Store(root)` with `articles()`, `getArticle(id)`, `putArticle(a)`, `deleteArticle(id)`, `lineups()`, `getLineup(slug)`, `putLineup(l)`, `state()`, `putState(s)`.
  - `images.ts`: `ensureImage(fetcher, publicDir, kind: "players" | "clubs", id, url?): Promise<string | undefined>`, which returns a public path like `/img/players/9357.jpg`.

- [ ] **Step 1: Write the failing tests**

`scraper/store.test.ts`:

````ts
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "./store.ts";
import type { Article, Lineup } from "./types.ts";

const article = (id: number): Article => ({
  id, url: "u", headline: "H", listHeadline: "H", category: "bundesliga", newsType: "fit",
  publishedAt: "2026-10-07T07:32:00.000Z", bodyHtml: "<p>x</p>", fetchedAt: "x",
});

describe("Store", () => {
  it("stores, lists and deletes articles", () => {
    const store = new Store(join(mkdtempSync(join(tmpdir(), "ti-")), "store"));
    expect(store.articles()).toEqual([]);
    store.putArticle(article(1));
    store.putArticle(article(2));
    expect(store.getArticle(2)).toEqual(article(2));
    expect(store.articles().map((a) => a.id).sort()).toEqual([1, 2]);
    store.deleteArticle(1);
    expect(store.getArticle(1)).toBeUndefined();
  });

  it("stores lineups by club slug and state", () => {
    const store = new Store(join(mkdtempSync(join(tmpdir(), "ti-")), "store"));
    const lineup = { club: { id: 14, slug: "borussia-dortmund", name: "BVB" }, formation: "", lines: [], updatedAt: "x" } as Lineup;
    store.putLineup(lineup);
    expect(store.getLineup("borussia-dortmund")).toEqual(lineup);
    expect(store.state()).toEqual({});
    store.putState({ lastChangeAt: "y" });
    expect(store.state()).toEqual({ lastChangeAt: "y" });
  });
});
````

`scraper/images.test.ts`:

````ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureImage } from "./images.ts";
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
````


- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run scraper/store.test.ts scraper/images.test.ts` → FAIL, modules not found.

- [ ] **Step 3: Implement**

`scraper/fetch.ts`:

````ts
export class HttpError extends Error {
  constructor(readonly status: number, url: string) {
    super(`HTTP ${status} for ${url}`);
  }
}

export type Fetcher = {
  text(url: string): Promise<string>;
  binary(url: string): Promise<Uint8Array>;
};

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Polite HTTP client: one request at a time, a pause between requests, one retry, timeout. */
export function createFetcher(opts: { delayMs?: number; timeoutMs?: number } = {}): Fetcher {
  const delayMs = opts.delayMs ?? 1000;
  const timeoutMs = opts.timeoutMs ?? 15000;
  let last = 0;

  async function get(url: string): Promise<Response> {
    for (let attempt = 1; ; attempt++) {
      const wait = last + delayMs - Date.now();
      if (wait > 0) await sleep(wait);
      last = Date.now();
      try {
        const res = await fetch(url, {
          headers: { "user-agent": USER_AGENT, "accept-language": "de-DE,de;q=0.9" },
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) throw new HttpError(res.status, url);
        return res;
      } catch (err) {
        if (attempt >= 2 || (err instanceof HttpError && err.status === 404)) throw err;
        await sleep(delayMs * 3);
      }
    }
  }

  return {
    async text(url) { return (await get(url)).text(); },
    async binary(url) { return new Uint8Array(await (await get(url)).arrayBuffer()); },
  };
}
````

`scraper/store.ts`:

````ts
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Article, Lineup, State } from "./types.ts";

/** File-based storage under one root directory (default: ./store). */
export class Store {
  constructor(readonly root: string) {
    mkdirSync(join(root, "articles"), { recursive: true });
    mkdirSync(join(root, "lineups"), { recursive: true });
  }

  private readJson<T>(path: string): T | undefined {
    return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : undefined;
  }

  private writeJson(path: string, value: unknown): void {
    writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
  }

  articles(): Article[] {
    return readdirSync(join(this.root, "articles"))
      .filter((f) => f.endsWith(".json"))
      .map((f) => this.readJson<Article>(join(this.root, "articles", f))!);
  }

  getArticle(id: number): Article | undefined {
    return this.readJson<Article>(join(this.root, "articles", `${id}.json`));
  }

  putArticle(a: Article): void {
    this.writeJson(join(this.root, "articles", `${a.id}.json`), a);
  }

  deleteArticle(id: number): void {
    rmSync(join(this.root, "articles", `${id}.json`), { force: true });
  }

  lineups(): Lineup[] {
    return readdirSync(join(this.root, "lineups"))
      .filter((f) => f.endsWith(".json"))
      .map((f) => this.readJson<Lineup>(join(this.root, "lineups", f))!);
  }

  getLineup(slug: string): Lineup | undefined {
    return this.readJson<Lineup>(join(this.root, "lineups", `${slug}.json`));
  }

  putLineup(l: Lineup): void {
    this.writeJson(join(this.root, "lineups", `${l.club.slug}.json`), l);
  }

  state(): State {
    return this.readJson<State>(join(this.root, "state.json")) ?? {};
  }

  putState(s: State): void {
    this.writeJson(join(this.root, "state.json"), s);
  }
}
````

`scraper/images.ts`:

````ts
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Fetcher } from "./fetch.ts";

/**
 * Downloads an image once and returns its public path (e.g. "/img/players/9357.jpg").
 * Returns undefined when there is no URL or the download fails (the UI falls back to initials).
 */
export async function ensureImage(
  fetcher: Fetcher,
  publicDir: string,
  kind: "players" | "clubs",
  id: number,
  url: string | undefined,
): Promise<string | undefined> {
  if (!url) return undefined;
  const ext = url.split("?")[0].toLowerCase().endsWith(".png") ? "png" : "jpg";
  const publicPath = `/img/${kind}/${id}.${ext}`;
  const file = join(publicDir, publicPath);
  if (existsSync(file)) return publicPath;
  try {
    const bytes = await fetcher.binary(url);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, bytes);
    return publicPath;
  } catch (err) {
    console.warn(`image download failed: ${url}: ${(err as Error).message}`);
    return undefined;
  }
}
````


- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run scraper/store.test.ts scraper/images.test.ts` → PASS (5 tests). Run: `npx tsc --noEmit` → no output.
(`createFetcher` talks to the network and is exercised by the live smoke run in Task 9.)

- [ ] **Step 5: Commit**

```bash
git add scraper/fetch.ts scraper/store.ts scraper/images.ts scraper/store.test.ts scraper/images.test.ts
git commit -m "feat: polite fetcher, JSON store and one-time image downloads"
```


### Task 8: Scrape run (orchestration)

**Files:**
- Create: `scraper/run.ts`
- Test: `scraper/run.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–7.
- Produces: `run({ store, fetcher, publicDir, now }): Promise<RunResult>` where `RunResult = { changed, lineupsChecked, newArticles, lineupsUpdated, problems }`; `lineupsDue(lineups, lastFetchedAt, now): boolean`; constants `OVERVIEWS`, `RETENTION_DAYS = 30`, `BACKFILL_PAGES = 3`.
- Behaviour: an empty store backfills 3 overview pages, otherwise page 1 only. An article is re-fetched only when its list headline changed. Articles that 404 are remembered in `state.unavailable`. Validation failures keep the old data and add a problem. Lineup cadence is 30 or 10 minutes. Retention deletes articles older than 30 days unless they are still listed.


- [ ] **Step 1: Write the failing test**

`scraper/run.test.ts`:

````ts
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
    expect(res.newArticles).toBeGreaterThan(20);
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
    expect(calls).toEqual([
      "https://www.ligainsider.de/bundesliga-news/uebersicht/",
      "https://www.ligainsider.de/testspiele-news/uebersicht/",
    ]);
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

  it("reports a problem when an overview suddenly has no articles (HTML changed)", async () => {
    const { fetcher } = fakeFetcher({ "https://www.ligainsider.de/testspiele-news/uebersicht/": "<html></html>" });
    const res = await run({ store, fetcher, publicDir, now: NOW });
    expect(res.problems).toContain("testspiele: overview returned 0 articles");
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
````

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scraper/run.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`scraper/run.ts`:

````ts
import { HttpError, type Fetcher } from "./fetch.ts";
import type { Store } from "./store.ts";
import type { Article, ArticleRef, Category, ClubRef, Lineup } from "./types.ts";
import { BASE_URL } from "./text.ts";
import { parseNewsList } from "./parse/newsList.ts";
import { parseArticle } from "./parse/article.ts";
import { parseClubs } from "./parse/clubs.ts";
import { parseClubPage } from "./parse/clubPage.ts";
import { validateArticle, validateLineup } from "./validate.ts";
import { ensureImage } from "./images.ts";

export const RETENTION_DAYS = 30;
export const BACKFILL_PAGES = 3;
const MINUTE = 60_000;

export const OVERVIEWS: { category: Category; url: (page: number) => string }[] = [
  {
    category: "bundesliga",
    url: (p) => (p === 1 ? `${BASE_URL}/bundesliga-news/uebersicht/` : `${BASE_URL}/startpage/uebersicht/${p}/`),
  },
  {
    category: "testspiele",
    url: (p) => (p === 1 ? `${BASE_URL}/testspiele-news/uebersicht/` : `${BASE_URL}/testspiele-news/uebersicht/${p}/`),
  },
];

export type RunOptions = { store: Store; fetcher: Fetcher; publicDir: string; now: Date };
export type RunResult = {
  /** Content changed: rebuild and deploy the site. */
  changed: boolean;
  /** Lineups were checked (even if unchanged): the cache must be saved so the timestamp survives. */
  lineupsChecked: boolean;
  newArticles: number;
  lineupsUpdated: number;
  problems: string[];
};

/** Lineups refresh every 30 min, or every 10 min if any known kickoff is within the next 48 h. */
export function lineupsDue(lineups: Lineup[], lastFetchedAt: string | undefined, now: Date): boolean {
  if (!lastFetchedAt) return true;
  const soon = lineups.some((l) => {
    if (!l.kickoff) return false;
    const diff = Date.parse(l.kickoff) - now.getTime();
    return diff > -3 * 60 * MINUTE && diff < 48 * 60 * MINUTE;
  });
  const interval = (soon ? 10 : 30) * MINUTE;
  return now.getTime() - Date.parse(lastFetchedAt) >= interval - MINUTE;
}

function withoutTimestamps(l: Lineup | undefined): string {
  return l ? JSON.stringify({ ...l, updatedAt: undefined }) : "";
}

function mediumCrest(url: string): string {
  return url.replace("/teams/small/", "/teams/medium/");
}

export async function run({ store, fetcher, publicDir, now }: RunOptions): Promise<RunResult> {
  const result: RunResult = { changed: false, lineupsChecked: false, newArticles: 0, lineupsUpdated: 0, problems: [] };
  const pages = store.articles().length === 0 ? BACKFILL_PAGES : 1;

  // 1. Collect article refs from the overviews. Bundesliga wins if an article is listed twice.
  const refs = new Map<number, { ref: ArticleRef; category: Category }>();
  let clubs: ClubRef[] = [];
  for (const overview of OVERVIEWS) {
    for (let page = 1; page <= pages; page++) {
      try {
        const html = await fetcher.text(overview.url(page));
        const list = parseNewsList(html);
        if (page === 1 && list.length === 0) result.problems.push(`${overview.category}: overview returned 0 articles`);
        if (overview.category === "bundesliga" && page === 1) clubs = parseClubs(html);
        for (const ref of list) if (!refs.has(ref.id)) refs.set(ref.id, { ref, category: overview.category });
      } catch (err) {
        result.problems.push(`${overview.category} page ${page}: ${(err as Error).message}`);
      }
    }
  }
  const clubById = new Map(clubs.map((c) => [c.id, c]));

  // 2. Fetch new or re-titled articles.
  const state = store.state();
  const unavailable: Record<string, string> = {};
  const cutoff = now.getTime() - RETENTION_DAYS * 24 * 60 * MINUTE;
  for (const { ref, category } of refs.values()) {
    const existing = store.getArticle(ref.id);
    if (existing && existing.listHeadline === ref.headline) continue;
    if (state.unavailable?.[ref.id] === ref.headline) {
      unavailable[ref.id] = ref.headline;
      continue;
    }
    try {
      const article: Article = parseArticle(await fetcher.text(ref.url), ref, category, now);
      const problems = validateArticle(article);
      if (problems.length) {
        result.problems.push(`article ${ref.id}: ${problems.join(", ")}`);
        continue;
      }
      if (article.player) {
        article.player.photo = await ensureImage(fetcher, publicDir, "players", article.player.id, ref.playerPhotoUrl);
      }
      if (article.club) {
        const club = clubById.get(article.club.id);
        article.club.crest = await ensureImage(fetcher, publicDir, "clubs", article.club.id, club && mediumCrest(club.crestUrl));
      }
      store.putArticle(article);
      result.changed = true;
      if (!existing) result.newArticles++;
    } catch (err) {
      if (err instanceof HttpError && err.status === 404) {
        console.log(`article ${ref.id} is listed but gone (404), skipping`);
        unavailable[ref.id] = ref.headline;
      } else {
        result.problems.push(`article ${ref.id}: ${(err as Error).message}`);
      }
    }
  }
  state.unavailable = unavailable;

  // 3. Lineups.
  if (clubs.length && lineupsDue(store.lineups(), state.lineupsFetchedAt, now)) {
    for (const club of clubs) {
      try {
        const lineup = parseClubPage(await fetcher.text(`${BASE_URL}/${club.slug}/${club.id}/`), club, now);
        const problems = validateLineup(lineup);
        if (problems.length) {
          result.problems.push(`lineup ${club.slug}: ${problems.join(", ")}`);
          continue;
        }
        lineup.club.crest = await ensureImage(fetcher, publicDir, "clubs", club.id, mediumCrest(club.crestUrl));
        for (const p of lineup.lines.flat()) {
          p.photo = await ensureImage(fetcher, publicDir, "players", p.id, p.photoUrl);
          if (p.alternative) {
            p.alternative.photo = await ensureImage(fetcher, publicDir, "players", p.alternative.id, p.alternative.photoUrl);
          }
        }
        if (withoutTimestamps(lineup) !== withoutTimestamps(store.getLineup(club.slug))) {
          store.putLineup(lineup);
          result.changed = true;
          result.lineupsUpdated++;
        }
      } catch (err) {
        result.problems.push(`lineup ${club.slug}: ${(err as Error).message}`);
      }
    }
    state.lineupsFetchedAt = now.toISOString();
    result.lineupsChecked = true;
  }

  // 4. Retention: drop old articles, unless LigaInsider still lists them (else we'd re-fetch them every run).
  for (const a of store.articles()) {
    if (Date.parse(a.publishedAt) < cutoff && !refs.has(a.id)) {
      store.deleteArticle(a.id);
      result.changed = true;
    }
  }

  if (result.changed) state.lastChangeAt = now.toISOString();
  store.putState(state);
  return result;
}
````

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run scraper/run.test.ts` → PASS (11 tests). Run: `npx tsc --noEmit` → no output.

- [ ] **Step 5: Commit**

```bash
git add scraper/run.ts scraper/run.test.ts
git commit -m "feat: scrape run with change detection, cadence and retention"
```


### Task 9: Snapshot/restore, CLI and a live smoke run

**Files:**
- Create: `scraper/snapshot.ts`, `scraper/cli.ts`
- Test: `scraper/snapshot.test.ts`

**Interfaces:**
- Consumes: `Store`, `Fetcher`, `createFetcher`, `ensureImage`, `run`.
- Produces: `writeSnapshot(store, file)`, `referencedImages(snapshot)`, `restoreFromSite(store, fetcher, siteUrl, publicDir): Promise<boolean>`. The CLI `tsx scraper/cli.ts scrape|restore|snapshot` writes `changed`, `save_cache` and `problems` to `$GITHUB_OUTPUT` when that variable is set.

- [ ] **Step 1: Write the failing test**

`scraper/snapshot.test.ts`:

````ts
import { describe, it, expect } from "vitest";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "./store.ts";
import { restoreFromSite, writeSnapshot, referencedImages } from "./snapshot.ts";
import type { Fetcher } from "./fetch.ts";
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

  it("returns false when the site has no snapshot", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ti-"));
    const fetcher: Fetcher = {
      async text() { throw new Error("HTTP 404"); },
      async binary() { throw new Error("HTTP 404"); },
    };
    expect(await restoreFromSite(new Store(join(dir, "s")), fetcher, "https://ti.example", join(dir, "p"))).toBe(false);
  });

  it("lists referenced images without duplicates", () => {
    expect(referencedImages({ articles: [article, article], lineups: [] }).sort()).toEqual([
      "/img/clubs/14.png",
      "/img/players/9357.jpg",
    ]);
  });
});
````


- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scraper/snapshot.test.ts` → FAIL, module not found.

- [ ] **Step 3: Implement**

`scraper/snapshot.ts`:

````ts
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Fetcher } from "./fetch.ts";
import type { Store } from "./store.ts";
import type { Article, Lineup, State } from "./types.ts";
import { ensureImage } from "./images.ts";

export type Snapshot = { version: 1; articles: Article[]; lineups: Lineup[]; state: State };

export function writeSnapshot(store: Store, file: string): void {
  const snapshot: Snapshot = { version: 1, articles: store.articles(), lineups: store.lineups(), state: store.state() };
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(snapshot));
}

/** Every local image path referenced by the data, e.g. "/img/players/9357.jpg". */
export function referencedImages(s: Pick<Snapshot, "articles" | "lineups">): string[] {
  const paths = new Set<string>();
  const add = (p?: string) => p && paths.add(p);
  for (const a of s.articles) { add(a.player?.photo); add(a.club?.crest); }
  for (const l of s.lineups) {
    add(l.club.crest);
    for (const p of l.lines.flat()) { add(p.photo); add(p.alternative?.photo); }
  }
  return [...paths];
}

/**
 * Restores store/ and images from our own deployed site. Used when the Actions cache was evicted.
 * Returns false if the site has no snapshot (e.g. very first deploy).
 */
export async function restoreFromSite(store: Store, fetcher: Fetcher, siteUrl: string, publicDir: string): Promise<boolean> {
  let snapshot: Snapshot;
  try {
    snapshot = JSON.parse(await fetcher.text(`${siteUrl.replace(/\/$/, "")}/data/snapshot.json`)) as Snapshot;
  } catch (err) {
    console.warn(`no snapshot on site: ${(err as Error).message}`);
    return false;
  }
  for (const a of snapshot.articles) store.putArticle(a);
  for (const l of snapshot.lineups) store.putLineup(l);
  store.putState(snapshot.state);
  for (const path of referencedImages(snapshot)) {
    const m = path.match(/^\/img\/(players|clubs)\/(\d+)\.\w+$/);
    if (m) await ensureImage(fetcher, publicDir, m[1] as "players" | "clubs", Number(m[2]), `${siteUrl.replace(/\/$/, "")}${path}`);
  }
  return true;
}
````

`scraper/cli.ts`:

````ts
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { createFetcher } from "./fetch.ts";
import { Store } from "./store.ts";
import { run } from "./run.ts";
import { restoreFromSite, writeSnapshot } from "./snapshot.ts";

const ROOT = process.cwd();
const store = new Store(join(ROOT, "store"));
const publicDir = join(ROOT, "public");

/** Writes key=value for later GitHub Actions steps (no-op locally). */
function output(key: string, value: string | number | boolean): void {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
}

const command = process.argv[2];

if (command === "scrape") {
  const result = await run({ store, fetcher: createFetcher(), publicDir, now: new Date() });
  console.log(`changed=${result.changed} new=${result.newArticles} lineups=${result.lineupsUpdated}`);
  for (const p of result.problems) console.warn(`PROBLEM: ${p}`);
  output("changed", result.changed);
  output("save_cache", result.changed || result.lineupsChecked);
  output("problems", result.problems.length);
} else if (command === "restore") {
  if (store.articles().length > 0) {
    console.log("store already populated, nothing to restore");
  } else if (process.env.SITE_URL) {
    const ok = await restoreFromSite(store, createFetcher({ delayMs: 50 }), process.env.SITE_URL, publicDir);
    console.log(ok ? `restored ${store.articles().length} articles from site` : "starting fresh");
  } else {
    console.log("SITE_URL not set, starting fresh");
  }
} else if (command === "snapshot") {
  writeSnapshot(store, join(publicDir, "data", "snapshot.json"));
  console.log("wrote public/data/snapshot.json");
} else {
  console.error("usage: tsx scraper/cli.ts <scrape|restore|snapshot>");
  process.exit(2);
}
````


- [ ] **Step 4: Run all tests**

Run: `npm test` → PASS (49 tests in 11 files). Run: `npm run typecheck` → no output.

- [ ] **Step 5: Live smoke run against ligainsider.de**

Run: `npm run scrape` (the first run takes about 5–8 minutes because it backfills about 85 articles, 18 lineups and about 280 images at 1 request/s).
Expected output resembles `changed=true new=86 lineups=18`. A few `PROBLEM:` lines are acceptable only if they are not 404s (404s are logged as "listed but gone").
Then run `npm run scrape` again. Expected: finishes in a few seconds with `changed=false new=0 lineups=0`.
Check: `ls store/articles | wc -l` is above 40, `ls store/lineups | wc -l` is 18, and `ls public/img/players | wc -l` is above 100.

- [ ] **Step 6: Commit**

```bash
git add scraper/snapshot.ts scraper/cli.ts scraper/snapshot.test.ts
git commit -m "feat: snapshot/restore and scraper CLI"
```


### Task 10: Site foundation and news pages

**Files:**
- Create: `astro.config.mjs`, `src/styles/global.css`, `src/lib/format.ts`, `src/lib/data.ts`, `src/layouts/Base.astro`, `src/components/Avatar.astro`, `src/components/StatusPill.astro`, `src/components/ArticleRow.astro`, `src/components/NewsFeed.astro`, `src/components/NewsTabs.astro`, `src/pages/index.astro`, `src/pages/news/[category].astro`, `src/pages/artikel/[id].astro`, `public/robots.txt`, `public/_headers`
- Test: `src/lib/format.test.ts`

**Interfaces:**
- Consumes: `store/` written by Task 9; types from `scraper/types.ts`.
- Produces:
  - `format.ts`: `time(iso)`, `dayKey(iso)`, `kickoff(iso)`, `fullDate(iso)`, `dayLabel(iso, now)`, `initials(name)`.
  - `data.ts`: `articles(category?)`, `clubArticles(clubId)`, `lineups()`, `lineupsByKickoff()`, `lastUpdate()`, `groupByDay(list)`.
  - `Base.astro` props `{ title; tab?: "news" | "aufstellungen" | "vereine"; back?: { href; label }; hideHeading? }`.
  - `Avatar.astro` props `{ src?; name; size?; class? }`.
  - `ArticleRow.astro` props `{ article }`.

- [ ] **Step 1: Write the failing format test**

`src/lib/format.test.ts`:

````ts
import { describe, it, expect } from "vitest";
import { dayLabel, fullDate, initials, kickoff, time } from "./format.ts";

const NOW = new Date("2026-10-07T09:00:00Z");

describe("format", () => {
  it("shows Berlin time", () => {
    expect(time("2026-10-07T07:32:00.000Z")).toBe("09:32");
    expect(fullDate("2026-10-07T07:32:00.000Z")).toBe("07.10.2026 · 09:32");
  });

  it("labels today and yesterday by Berlin calendar day", () => {
    expect(dayLabel("2026-10-07T05:00:00Z", NOW)).toBe("Heute · Mi., 07.10.");
    expect(dayLabel("2026-10-06T21:59:00Z", NOW)).toBe("Gestern · Di., 06.10.");
    expect(dayLabel("2026-10-06T22:30:00Z", NOW)).toBe("Heute · Mi., 07.10.");
    expect(dayLabel("2026-10-04T12:00:00Z", NOW)).toBe("So., 04.10.");
  });

  it("formats kickoff", () => {
    expect(kickoff("2026-10-09T18:30:00.000Z")).toBe("Fr. · 09.10., 20:30 Uhr");
  });

  it("builds initials for the photo fallback", () => {
    expect(initials("Gregor Kobel")).toBe("GK");
    expect(initials("N. Schlotterbeck")).toBe("NS");
    expect(initials("Kobel")).toBe("K");
  });
});
````


- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/format.test.ts` → FAIL, module not found.

- [ ] **Step 3: Implement the format helpers**

`src/lib/format.ts`:

````ts
const TZ = "Europe/Berlin";

const dayKeyFmt = new Intl.DateTimeFormat("de-DE", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const timeFmt = new Intl.DateTimeFormat("de-DE", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
const dayLabelFmt = new Intl.DateTimeFormat("de-DE", { timeZone: TZ, weekday: "short", day: "2-digit", month: "2-digit" });
const kickoffFmt = new Intl.DateTimeFormat("de-DE", { timeZone: TZ, weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const fullFmt = new Intl.DateTimeFormat("de-DE", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

export const time = (iso: string) => timeFmt.format(new Date(iso));
export const dayKey = (iso: string) => dayKeyFmt.format(new Date(iso));
export const kickoff = (iso: string) => kickoffFmt.format(new Date(iso)).replace(",", " ·") + " Uhr";
export const fullDate = (iso: string) => fullFmt.format(new Date(iso)).replace(",", " ·");

/** "Heute · Mi., 07.10." / "Gestern · …" / "Mo., 05.10." relative to the build time. */
export function dayLabel(iso: string, now: Date): string {
  const label = dayLabelFmt.format(new Date(iso));
  const key = dayKey(iso);
  if (key === dayKey(now.toISOString())) return `Heute · ${label}`;
  if (key === dayKey(new Date(now.getTime() - 86_400_000).toISOString())) return `Gestern · ${label}`;
  return label;
}

export function initials(name: string): string {
  const parts = name.replace(/\./g, "").split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}
````


- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/format.test.ts` → PASS (4 tests).

- [ ] **Step 5: Create the Astro config, theme, data access and static files**

`astro.config.mjs`:

````js
// @ts-check
import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  output: "static",
  trailingSlash: "always",
  build: { format: "directory" },
  vite: { plugins: [tailwindcss()] },
});
````

`src/styles/global.css`:

````css
@import "tailwindcss";

/* Colours follow iOS system colours. Light is the default; dark via system setting or data-theme="dark". */
:root {
  --bg: #ffffff;
  --surface: #f2f2f7;
  --surface-raised: #ffffff;
  --fg: #1d1d1f;
  --muted: #86868b;
  --hairline: #e5e5ea;
  --accent: #248a3d;
  --tabbar: rgba(250, 250, 252, 0.94);
  --pitch-from: #f3f8f2;
  --pitch-to: #e8f2e6;
  --pitch-line: rgba(36, 138, 61, 0.22);
  --red-bg: #ffebe9; --red-fg: #d70015;
  --yellow-bg: #fff4d6; --yellow-fg: #a05a00; --yellow-dot: #ffcc00;
  --green-bg: #e3f7e8; --green-fg: #248a3d; --green-dot: #30d158;
  color-scheme: light;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #000000; --surface: #1c1c1e; --surface-raised: #2c2c2e; --fg: #f5f5f7; --muted: #8e8e93;
    --hairline: #2c2c2e; --accent: #30d158; --tabbar: rgba(22, 22, 24, 0.92);
    --pitch-from: #0f1a12; --pitch-to: #0b140d; --pitch-line: rgba(48, 209, 88, 0.18);
    --red-bg: rgba(255, 69, 58, 0.16); --red-fg: #ff6961;
    --yellow-bg: rgba(255, 214, 10, 0.14); --yellow-fg: #ffd60a; --yellow-dot: #ffd60a;
    --green-bg: rgba(48, 209, 88, 0.16); --green-fg: #30d158; --green-dot: #30d158;
    color-scheme: dark;
  }
}

:root[data-theme="dark"] {
  --bg: #000000; --surface: #1c1c1e; --surface-raised: #2c2c2e; --fg: #f5f5f7; --muted: #8e8e93;
  --hairline: #2c2c2e; --accent: #30d158; --tabbar: rgba(22, 22, 24, 0.92);
  --pitch-from: #0f1a12; --pitch-to: #0b140d; --pitch-line: rgba(48, 209, 88, 0.18);
  --red-bg: rgba(255, 69, 58, 0.16); --red-fg: #ff6961;
  --yellow-bg: rgba(255, 214, 10, 0.14); --yellow-fg: #ffd60a; --yellow-dot: #ffd60a;
  --green-bg: rgba(48, 209, 88, 0.16); --green-fg: #30d158; --green-dot: #30d158;
  color-scheme: dark;
}

@theme inline {
  --color-bg: var(--bg);
  --color-surface: var(--surface);
  --color-raised: var(--surface-raised);
  --color-fg: var(--fg);
  --color-muted: var(--muted);
  --color-hairline: var(--hairline);
  --color-accent: var(--accent);
  --font-sans: -apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, system-ui, sans-serif;
}

html {
  background: var(--bg);
  color: var(--fg);
  -webkit-font-smoothing: antialiased;
  -webkit-tap-highlight-color: transparent;
}

/* Article body comes from the sanitiser: only p, h3, b, strong, i, em, br, a. */
.prose-body p { margin: 0 0 1em; }
.prose-body h3 { font-size: 1.15rem; font-weight: 700; letter-spacing: -0.01em; margin: 1.6em 0 0.6em; }
.prose-body a { color: var(--accent); text-decoration: underline; text-underline-offset: 2px; }
````

`src/lib/data.ts`:

````ts
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Article, Category, Lineup, State } from "../../scraper/types.ts";
import { dayKey } from "./format.ts";

const STORE = join(process.cwd(), "store");

function readDir<T>(dir: string): T[] {
  const path = join(STORE, dir);
  if (!existsSync(path)) return [];
  return readdirSync(path)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(path, f), "utf8")) as T);
}

let cache: { articles: Article[]; lineups: Lineup[]; state: State } | undefined;

function load() {
  if (!cache) {
    const statePath = join(STORE, "state.json");
    cache = {
      articles: readDir<Article>("articles").sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)),
      lineups: readDir<Lineup>("lineups").sort((a, b) => a.club.name.localeCompare(b.club.name, "de")),
      state: existsSync(statePath) ? (JSON.parse(readFileSync(statePath, "utf8")) as State) : {},
    };
  }
  return cache;
}

/** Newest first, optionally filtered by category. */
export function articles(category?: Category): Article[] {
  const all = load().articles;
  return category ? all.filter((a) => a.category === category) : all;
}

export function clubArticles(clubId: number): Article[] {
  return load().articles.filter((a) => a.club?.id === clubId);
}

/** Alphabetical by club name. */
export function lineups(): Lineup[] {
  return load().lineups;
}

/** Sorted by kickoff, then club name; lineups without kickoff go last. */
export function lineupsByKickoff(): Lineup[] {
  return [...load().lineups].sort(
    (a, b) => (a.kickoff ?? "9999").localeCompare(b.kickoff ?? "9999") || a.club.name.localeCompare(b.club.name, "de"),
  );
}

export function lastUpdate(): string | undefined {
  return load().state.lastChangeAt;
}

/** Groups articles (already sorted newest first) into consecutive Berlin calendar days. */
export function groupByDay(list: Article[]): { day: string; first: string; items: Article[] }[] {
  const groups: { day: string; first: string; items: Article[] }[] = [];
  for (const a of list) {
    const day = dayKey(a.publishedAt);
    const last = groups[groups.length - 1];
    if (last?.day === day) last.items.push(a);
    else groups.push({ day, first: a.publishedAt, items: [a] });
  }
  return groups;
}
````

`public/robots.txt`:

````text
User-agent: *
Disallow: /
````

`public/_headers`:

````text
/*
  X-Robots-Tag: noindex, nofollow
  Referrer-Policy: no-referrer
````


- [ ] **Step 6: Create the layout and components**

`src/layouts/Base.astro`:

````astro
---
import "../styles/global.css";
import { lastUpdate } from "../lib/data.ts";
import { fullDate } from "../lib/format.ts";

interface Props {
  title: string;
  tab?: "news" | "aufstellungen" | "vereine";
  back?: { href: string; label: string };
  /** Hide the big page title (article pages show their own headline). */
  hideHeading?: boolean;
}
const { title, tab, back, hideHeading = false } = Astro.props;
const updated = lastUpdate();
const tabs = [
  { id: "news", href: "/", label: "News", icon: "M4 5h16M4 12h16M4 19h10" },
  { id: "aufstellungen", href: "/aufstellungen/", label: "Aufstellungen", icon: "M12 3v18M3 12h18M7 7h10v10H7z" },
  { id: "vereine", href: "/vereine/", label: "Vereine", icon: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" },
] as const;
---
<!doctype html>
<html lang="de">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="robots" content="noindex, nofollow" />
    <meta name="theme-color" content="#000000" media="(prefers-color-scheme: dark)" />
    <meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)" />
    <title>{title} · tonisInsider</title>
    <script is:inline>
      try {
        const t = localStorage.getItem("theme");
        if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
      } catch {}
    </script>
  </head>
  <body class="min-h-dvh bg-bg font-sans text-fg">
    <div class="mx-auto max-w-[720px] px-4 pb-28 sm:px-6">
      <header class="flex items-end justify-between pt-6 pb-3">
        <div class="min-w-0">
          {back && (
            <a href={back.href} class="mb-2 inline-block text-[15px] text-accent">‹ {back.label}</a>
          )}
          {!hideHeading && <h1 class="truncate text-[28px] font-bold tracking-[-0.03em]">{title}</h1>}
        </div>
        <button
          id="theme-toggle"
          type="button"
          aria-label="Hell/Dunkel umschalten"
          class="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface text-sm"
        >◐</button>
      </header>
      <slot />
      <footer class="mt-10 border-t border-hairline pt-4 text-xs text-muted">
        {updated && <p>Stand: {fullDate(updated)} Uhr</p>}
        <p class="mt-1">Inhalte von <a class="underline" href="https://www.ligainsider.de/" target="_blank" rel="noopener noreferrer">ligainsider.de</a> · privates Projekt, nicht öffentlich.</p>
      </footer>
    </div>
    <nav class="fixed inset-x-0 bottom-0 border-t border-hairline bg-[var(--tabbar)] pb-[env(safe-area-inset-bottom)] backdrop-blur-xl">
      <div class="mx-auto flex max-w-[720px] justify-around pt-2 pb-2">
        {tabs.map((t) => (
          <a href={t.href} class:list={["flex flex-col items-center gap-0.5 px-4 text-[10px] font-medium", tab === t.id ? "text-accent" : "text-muted"]}>
            <svg viewBox="0 0 24 24" class="size-6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d={t.icon} /></svg>
            {t.label}
          </a>
        ))}
      </div>
    </nav>
    <script is:inline>
      document.getElementById("theme-toggle").addEventListener("click", () => {
        const root = document.documentElement;
        const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
        root.dataset.theme = dark ? "light" : "dark";
        try { localStorage.setItem("theme", root.dataset.theme); } catch {}
      });
    </script>
  </body>
</html>
````

`src/components/Avatar.astro`:

````astro
---
import { initials } from "../lib/format.ts";

interface Props {
  src?: string;
  name: string;
  size?: number;
  class?: string;
}
const { src, name, size = 32, class: className } = Astro.props;
---
<span
  class:list={["relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface font-semibold text-muted", className]}
  style={`width:${size}px;height:${size}px;font-size:${Math.round(size * 0.36)}px`}
>
  <span aria-hidden="true">{initials(name)}</span>
  {src && (
    <img
      src={src}
      alt={name}
      loading="lazy"
      class="absolute inset-0 size-full object-cover"
      onerror="this.remove()"
    />
  )}
</span>
````

`src/components/StatusPill.astro`:

````astro
---
import type { NewsType } from "../../scraper/types.ts";

interface Props { type: NewsType }
const STYLES: Record<NewsType, { label: string; tone: "red" | "yellow" | "green" } | undefined> = {
  verletzung: { label: "Verletzung", tone: "red" },
  angeschlagen: { label: "Angeschlagen", tone: "yellow" },
  aufbautraining: { label: "Aufbautraining", tone: "green" },
  fit: { label: "Fit", tone: "green" },
  sonstiges: undefined,
};
const style = STYLES[Astro.props.type];
---
{style && (
  <span
    class="rounded-full px-[7px] py-[2px] text-[10.5px] font-semibold"
    style={`background:var(--${style.tone}-bg);color:var(--${style.tone}-fg)`}
  >{style.label}</span>
)}
````

`src/components/ArticleRow.astro`:

````astro
---
import type { Article } from "../../scraper/types.ts";
import Avatar from "./Avatar.astro";
import StatusPill from "./StatusPill.astro";
import { time } from "../lib/format.ts";

interface Props { article: Article }
const { article: a } = Astro.props;
---
<a href={`/artikel/${a.id}/`} class="flex items-start gap-3 py-3 active:opacity-60">
  <span class="relative">
    <Avatar src={a.player?.photo ?? a.club?.crest} name={a.player?.name ?? a.club?.name ?? "LigaInsider"} size={40} />
    {a.player && a.club?.crest && (
      <img src={a.club.crest} alt="" class="absolute -right-1 -bottom-1 size-[18px] rounded-full bg-bg object-contain p-[1px]" />
    )}
  </span>
  <span class="min-w-0 flex-1">
    <span class="mb-1 block text-[15px] leading-snug font-semibold tracking-[-0.01em]">{a.headline}</span>
    <span class="flex items-center gap-1.5 text-xs text-muted">
      <StatusPill type={a.newsType} />
      <span>{a.player?.name ?? a.club?.name ?? "LigaInsider"} · {time(a.publishedAt)}</span>
    </span>
  </span>
</a>
````

`src/components/NewsFeed.astro`:

````astro
---
import type { Article } from "../../scraper/types.ts";
import ArticleRow from "./ArticleRow.astro";
import { groupByDay } from "../lib/data.ts";
import { dayLabel } from "../lib/format.ts";

interface Props { articles: Article[] }
const now = new Date();
const groups = groupByDay(Astro.props.articles);
---
{groups.length === 0 && <p class="py-10 text-center text-muted">Noch keine News.</p>}
{groups.map((g) => (
  <section class="mb-2">
    <h2 class="sticky top-0 z-10 bg-bg/90 py-2 text-xs font-semibold tracking-wide text-muted uppercase backdrop-blur">
      {dayLabel(g.first, now)}
    </h2>
    <div class="divide-y divide-hairline">
      {g.items.map((a) => <ArticleRow article={a} />)}
    </div>
  </section>
))}
````

`src/components/NewsTabs.astro`:

````astro
---
interface Props { active: "alle" | "bundesliga" | "testspiele" }
const items = [
  { id: "alle", href: "/", label: "Alle" },
  { id: "bundesliga", href: "/news/bundesliga/", label: "Bundesliga" },
  { id: "testspiele", href: "/news/testspiele/", label: "Testspiele" },
] as const;
---
<nav class="mb-3 flex rounded-[10px] bg-surface p-[2px] text-[13px] font-semibold">
  {items.map((i) => (
    <a
      href={i.href}
      class:list={["flex-1 rounded-lg py-1.5 text-center", Astro.props.active === i.id ? "bg-raised text-fg shadow-sm" : "text-muted"]}
    >{i.label}</a>
  ))}
</nav>
````


- [ ] **Step 7: Create the news pages**

`src/pages/index.astro`:

````astro
---
import Base from "../layouts/Base.astro";
import NewsTabs from "../components/NewsTabs.astro";
import NewsFeed from "../components/NewsFeed.astro";
import { articles } from "../lib/data.ts";
---
<Base title="News" tab="news">
  <NewsTabs active="alle" />
  <NewsFeed articles={articles()} />
</Base>
````

`src/pages/news/[category].astro`:

````astro
---
import Base from "../../layouts/Base.astro";
import NewsTabs from "../../components/NewsTabs.astro";
import NewsFeed from "../../components/NewsFeed.astro";
import { articles } from "../../lib/data.ts";

export function getStaticPaths() {
  return [{ params: { category: "bundesliga" } }, { params: { category: "testspiele" } }];
}
const category = Astro.params.category as "bundesliga" | "testspiele";
---
<Base title="News" tab="news">
  <NewsTabs active={category} />
  <NewsFeed articles={articles(category)} />
</Base>
````

`src/pages/artikel/[id].astro`:

````astro
---
import Base from "../../layouts/Base.astro";
import Avatar from "../../components/Avatar.astro";
import StatusPill from "../../components/StatusPill.astro";
import { articles } from "../../lib/data.ts";
import { fullDate } from "../../lib/format.ts";
import type { Article } from "../../../scraper/types.ts";

export function getStaticPaths() {
  return articles().map((article) => ({ params: { id: String(article.id) }, props: { article } }));
}
const { article: a } = Astro.props as { article: Article };
const clubLineupHref = a.club ? `/vereine/${a.club.slug}/` : undefined;
---
<Base title={a.headline} tab="news" back={{ href: "/", label: "News" }} hideHeading>
  <article class="pt-2">
    {(a.player || a.club) && (
      <div class="mb-4 flex items-center gap-3">
        <Avatar src={a.player?.photo ?? a.club?.crest} name={a.player?.name ?? a.club!.name} size={44} />
        <div class="text-xs leading-snug text-muted">
          {a.player && <b class="block text-sm text-fg">{a.player.name}</b>}
          {a.club && (clubLineupHref ? <a href={clubLineupHref} class="underline-offset-2 hover:underline">{a.club.name}</a> : a.club.name)}
        </div>
        <span class="ml-auto"><StatusPill type={a.newsType} /></span>
      </div>
    )}
    <h1 class="mb-2 text-[26px] leading-[1.15] font-bold tracking-[-0.025em]">{a.headline}</h1>
    <p class="mb-6 text-xs text-muted">
      {fullDate(a.publishedAt)} Uhr{a.author && ` · ${a.author}`}{a.source && " · Quelle: "}
      {a.source && (a.source.url ? <a href={a.source.url} target="_blank" rel="noopener noreferrer" class="underline">{a.source.name}</a> : a.source.name)}
    </p>
    <div class="prose-body text-[16px] leading-[1.6]" set:html={a.bodyHtml} />
    <a
      href={a.url}
      target="_blank"
      rel="noopener noreferrer"
      class="mt-6 inline-flex rounded-full bg-surface px-4 py-2 text-sm font-medium"
    >Original auf ligainsider.de ↗</a>
  </article>
</Base>
````


- [ ] **Step 8: Build and look at it**

Run: `npm run build` → "page(s) built", with no errors. `dist/data/snapshot.json` exists.
Run: `npm run preview` and open `http://localhost:4321/` in a narrow browser window (390 px) or on a phone on the same network (`npm run preview -- --host`).
Check:
- The news list is grouped "Heute · …" / "Gestern · …", with player photos and club crest badges and pills (Verletzung red, Angeschlagen yellow, Fit/Aufbautraining green).
- Tapping a headline shows the full article, a source link, and "Original auf ligainsider.de ↗".
- The ◐ button toggles dark/light and survives a reload.
- No horizontal scrolling.

- [ ] **Step 9: Commit**

```bash
git add astro.config.mjs src public/robots.txt public/_headers
git commit -m "feat: news hub and article pages"
```


### Task 11: Predicted-XI pitch, lineup overview and club pages

**Files:**
- Create: `src/components/Pitch.astro`, `src/components/MatchHeader.astro`, `src/pages/aufstellungen.astro`, `src/pages/vereine/index.astro`, `src/pages/vereine/[slug].astro`

**Interfaces:**
- Consumes: `Avatar.astro`, `ArticleRow.astro`, `Base.astro`, `lineups()`, `lineupsByKickoff()`, `clubArticles()`, `kickoff()` (Task 10).
- Produces: `Pitch.astro` props `{ lineup; compact? }` and `MatchHeader.astro` props `{ lineup }`.

- [ ] **Step 1: Create the pitch and match header**

`src/components/Pitch.astro`:

````astro
---
import type { Lineup } from "../../scraper/types.ts";
import Avatar from "./Avatar.astro";

interface Props { lineup: Lineup; compact?: boolean }
const { lineup, compact = false } = Astro.props;
const rows = lineup.lines.length;
// Goalkeeper at the bottom, attack at the top. Leave room for names below the avatars.
const top = (i: number) => (rows <= 1 ? 50 : 90 - (i * 78) / (rows - 1));
const left = (j: number, n: number) => ((j + 1) * 100) / (n + 1);
const size = compact ? 28 : 40;
---
<div
  class="relative w-full overflow-hidden rounded-[18px]"
  style={`aspect-ratio:${compact ? "4 / 4.4" : "4 / 5"};background:linear-gradient(var(--pitch-from),var(--pitch-to))`}
>
  <div class="absolute inset-3 rounded-md border-[1.5px]" style="border-color:var(--pitch-line)"></div>
  <div class="absolute inset-x-3 top-1/2 border-t-[1.5px]" style="border-color:var(--pitch-line)"></div>
  <div class="absolute top-1/2 left-1/2 size-16 -translate-1/2 rounded-full border-[1.5px]" style="border-color:var(--pitch-line)"></div>
  {lineup.lines.map((line, i) =>
    line.map((p, j) => (
      <div class="absolute flex w-[22%] -translate-1/2 flex-col items-center text-center" style={`top:${top(i)}%;left:${left(j, line.length)}%`}>
        <span class="relative">
          <Avatar src={p.photo} name={p.name} size={size} class="shadow-sm ring-2 ring-white/80" />
          <span
            class="absolute -top-0.5 -right-0.5 size-3 rounded-full border-2 border-white"
            style={`background:var(--${p.status === "doubtful" ? "yellow" : "green"}-dot)`}
            title={p.statusLabel ?? "Gesetzt"}
          ></span>
        </span>
        <span class:list={["mt-1 max-w-full truncate font-semibold", compact ? "text-[9.5px]" : "text-[11px]"]}>{p.name}</span>
        {p.alternative && !compact && (
          <span class="max-w-full truncate text-[9.5px]" style="color:var(--yellow-fg)">Alt: {p.alternative.name}</span>
        )}
      </div>
    )),
  )}
</div>
{!compact && (
  <div class="flex justify-center gap-4 py-3 text-[11px] text-muted">
    <span class="flex items-center gap-1"><i class="size-2 rounded-full" style="background:var(--green-dot)"></i>Gesetzt</span>
    <span class="flex items-center gap-1"><i class="size-2 rounded-full" style="background:var(--yellow-dot)"></i>Fraglich</span>
  </div>
)}
````

`src/components/MatchHeader.astro`:

````astro
---
import type { Lineup } from "../../scraper/types.ts";
import { kickoff } from "../lib/format.ts";

interface Props { lineup: Lineup }
const { lineup: l } = Astro.props;
---
<div class="flex items-center gap-3 py-2">
  {l.club.crest && <img src={l.club.crest} alt="" class="size-9 object-contain" />}
  <div class="min-w-0 text-sm">
    <p class="truncate font-semibold">
      {l.opponent ? `${l.opponent.home ? "vs" : "@"} ${l.opponent.name}` : "Nächstes Spiel"}
    </p>
    <p class="text-xs text-muted">
      {[l.matchday && `${l.matchday}. Spieltag`, l.kickoff && kickoff(l.kickoff), l.formation].filter(Boolean).join(" · ")}
    </p>
  </div>
</div>
````


- [ ] **Step 2: Create the pages**

`src/pages/aufstellungen.astro`:

````astro
---
import Base from "../layouts/Base.astro";
import Pitch from "../components/Pitch.astro";
import MatchHeader from "../components/MatchHeader.astro";
import { lineupsByKickoff } from "../lib/data.ts";

const list = lineupsByKickoff();
const matchday = list.find((l) => l.matchday)?.matchday;
---
<Base title={matchday ? `${matchday}. Spieltag` : "Aufstellungen"} tab="aufstellungen">
  {list.length === 0 && <p class="py-10 text-center text-muted">Noch keine Aufstellungen.</p>}
  <div class="grid gap-x-4 gap-y-6 sm:grid-cols-2">
    {list.map((l) => (
      <a href={`/vereine/${l.club.slug}/`} class="block active:opacity-70">
        <MatchHeader lineup={l} />
        <Pitch lineup={l} compact />
      </a>
    ))}
  </div>
</Base>
````

`src/pages/vereine/index.astro`:

````astro
---
import Base from "../../layouts/Base.astro";
import Avatar from "../../components/Avatar.astro";
import { lineups } from "../../lib/data.ts";
---
<Base title="Vereine" tab="vereine">
  <div class="divide-y divide-hairline">
    {lineups().map((l) => (
      <a href={`/vereine/${l.club.slug}/`} class="flex items-center gap-3 py-3 active:opacity-60">
        <Avatar src={l.club.crest} name={l.club.name} size={36} class="bg-transparent [&>img]:object-contain" />
        <span class="flex-1 font-semibold">{l.club.name}</span>
        <span class="text-muted">›</span>
      </a>
    ))}
  </div>
</Base>
````

`src/pages/vereine/[slug].astro`:

````astro
---
import Base from "../../layouts/Base.astro";
import Pitch from "../../components/Pitch.astro";
import MatchHeader from "../../components/MatchHeader.astro";
import ArticleRow from "../../components/ArticleRow.astro";
import { clubArticles, lineups } from "../../lib/data.ts";
import type { Lineup } from "../../../scraper/types.ts";

export function getStaticPaths() {
  return lineups().map((lineup) => ({ params: { slug: lineup.club.slug }, props: { lineup } }));
}
const { lineup } = Astro.props as { lineup: Lineup };
const news = clubArticles(lineup.club.id);
---
<Base title={lineup.club.name} tab="vereine" back={{ href: "/vereine/", label: "Vereine" }}>
  <h2 class="mt-2 text-xs font-semibold tracking-wide text-muted uppercase">Voraussichtliche Aufstellung</h2>
  <MatchHeader lineup={lineup} />
  <Pitch lineup={lineup} />
  <h2 class="mt-6 text-xs font-semibold tracking-wide text-muted uppercase">News</h2>
  {news.length === 0 && <p class="py-6 text-sm text-muted">Keine aktuellen News.</p>}
  <div class="divide-y divide-hairline">
    {news.map((a) => <ArticleRow article={a} />)}
  </div>
</Base>
````


- [ ] **Step 3: Build and look at it**

Run: `npm run build` → about 110 pages built (1 + 2 news + ~85 articles + aufstellungen + vereine + 18 clubs).
Run: `npm run preview` and check at 390 px width in light and dark:
- `/vereine/borussia-dortmund/` shows the pitch with the goalkeeper at the bottom, a yellow dot on doubtful players, "Alt: …" under players with an alternative, and the club's news below.
- `/aufstellungen/` shows all 18 compact pitches, sorted by kickoff, so the two sides of each match sit next to each other.
- `/vereine/` lists 18 clubs with crests.
- The tab bar highlights the current section.

- [ ] **Step 4: Commit**

```bash
git add src/components/Pitch.astro src/components/MatchHeader.astro src/pages/aufstellungen.astro src/pages/vereine
git commit -m "feat: predicted XI pitch, lineups overview and club pages"
```


### Task 12: GitHub Actions workflow, README and first deploy

**Files:**
- Create: `.github/workflows/scrape.yml`, `README.md`

**Interfaces:**
- Consumes: the npm scripts `typecheck`, `restore`, `scrape` and `build`, plus the CLI outputs `changed`, `save_cache` and `problems` (Task 9).
- Needs from the owner: Cloudflare API token, account ID, and Pages project name. A **public** GitHub repo.

- [ ] **Step 1: Create the workflow**

`.github/workflows/scrape.yml`:

````yaml
name: scrape-and-deploy

on:
  schedule:
    - cron: "*/5 * * * *"
  workflow_dispatch:
  push:
    branches: [main]

# Never run two scrapes at once; queue instead of cancelling (a cancelled run would lose its cache save).
concurrency:
  group: scrape
  cancel-in-progress: false

permissions:
  contents: read
  actions: write # keep-alive re-enables this workflow

jobs:
  scrape:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v5

      - uses: actions/setup-node@v5
        with:
          node-version: 24
          cache: npm

      - run: npm ci

      - name: Typecheck (code changes only)
        if: github.event_name != 'schedule'
        run: npm run typecheck

      - name: Restore data cache
        uses: actions/cache/restore@v4
        with:
          path: |
            store
            public/img
          key: data-${{ github.run_id }}
          restore-keys: data-

      - name: Restore from our own site if the cache was lost
        run: npm run restore
        env:
          SITE_URL: ${{ vars.SITE_URL }}

      - name: Scrape
        id: scrape
        run: npm run scrape

      - name: Save data cache
        if: steps.scrape.outputs.save_cache == 'true'
        uses: actions/cache/save@v4
        with:
          path: |
            store
            public/img
          key: data-${{ github.run_id }}

      - name: Build
        if: steps.scrape.outputs.changed == 'true' || github.event_name != 'schedule'
        run: npm run build

      - name: Deploy to Cloudflare Pages
        if: steps.scrape.outputs.changed == 'true' || github.event_name != 'schedule'
        run: npx wrangler pages deploy dist --project-name="${{ vars.CF_PAGES_PROJECT }}" --branch=main --commit-dirty=true
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}

      # GitHub pauses scheduled workflows in public repos after 60 days without activity.
      # Re-enabling once a day (first run after midnight UTC) resets that timer.
      - name: Keep-alive
        if: github.event_name == 'schedule'
        run: |
          if [ "$(date -u +%H%M)" \< "0005" ]; then
            gh api -X PUT "repos/${{ github.repository }}/actions/workflows/scrape.yml/enable"
          fi
        env:
          GH_TOKEN: ${{ github.token }}

      - name: Fail if the scraper reported problems (GitHub emails you)
        if: steps.scrape.outputs.problems != '0'
        run: |
          echo "The scraper reported problems; see the Scrape step log. LigaInsider may have changed their HTML."
          exit 1
````


- [ ] **Step 2: Create README.md**

````markdown
# tonisInsider

Private, ad-free reader for ligainsider.de news and predicted Bundesliga XIs. Only for me and friends: not indexed, not public.

## How it works

A GitHub Actions cron (every 5 min) scrapes LigaInsider. Data lives in the Actions cache, never in git. When something changed, it builds the Astro site and deploys it to Cloudflare Pages. See `docs/superpowers/specs/2026-10-07-tonisinsider-design.md`.

## Local development

```bash
npm install
npm run scrape     # first run: ~5–8 min backfill; later runs: seconds
npm run dev        # http://localhost:4321
npm test           # needs scraper/__fixtures__/ (git-ignored, real pages)
```

## One-time setup (owner)

1. **Cloudflare:** create an API token with the "Cloudflare Pages: Edit" permission, and note your account ID.
2. **Pick an unguessable project name**, e.g. `tonisinsider-7f3k9q`. The site URL becomes `https://<name>.pages.dev`, and nobody can find it without the link.
   ```bash
   npx wrangler login
   npx wrangler pages project create <name> --production-branch=main
   ```
3. **GitHub:** create a **public** repo (public = unlimited free Actions minutes; it only contains code) and push.
4. In the repo settings → Secrets and variables → Actions:
   - Secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
   - Variables: `CF_PAGES_PROJECT` = `<name>`, `SITE_URL` = `https://<name>.pages.dev`
5. Actions tab → `scrape-and-deploy` → "Run workflow" once. The first run backfills (~8 min).

## When GitHub emails "run failed"

The Scrape step log lists `PROBLEM:` lines. Usually LigaInsider changed their HTML. Save the affected page into `scraper/__fixtures__/`, update the parser until `npm test` passes, then push.
````

- [ ] **Step 3: Verify locally**

Run: `npm test && npm run typecheck && npm run build` → all green.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/scrape.yml README.md
git commit -m "ci: scrape every 5 minutes and deploy to Cloudflare Pages"
```

- [ ] **Step 5: Owner setup and first deploy (needs the owner; ask before creating anything external)**

Walk the owner through README "One-time setup" steps 1–5. Do not create the GitHub repo or the Cloudflare project without explicit confirmation, because creating a public repo is an outward-facing action. Before pushing, check that no content is tracked:
`git ls-files | grep -E "^(store|public/img|public/data|scraper/__fixtures__)/"` → no output.

- [ ] **Step 6: Verify the deployed site**

- The manual run is green, and its Deploy step prints a `*.pages.dev` URL.
- Open `SITE_URL` on a phone: news, an article, `/aufstellungen/` and a club page all work in light and dark.
- `curl -sI $SITE_URL | grep -i x-robots-tag` → `noindex, nofollow`.
- `curl -s $SITE_URL/data/snapshot.json | head -c 100` → JSON starting with `{"version":1`.
- Within 10 minutes, scheduled runs appear. Runs without news finish in under a minute and skip Build and Deploy.
