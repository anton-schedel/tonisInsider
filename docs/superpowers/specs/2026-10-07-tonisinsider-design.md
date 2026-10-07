# tonisInsider — Design Spec

**Date:** 2026-10-07
**Status:** Approved (rev. 2: public code-only repo, sanitised HTML bodies, lineup model matched to real markup)

## 1. Goal

A private, ad-free, fast and modern mirror of the parts of ligainsider.de that matter for fantasy managers (Kickbase, Comunio, etc.): the **news feed** and the **predicted starting XIs** for the 1. Bundesliga. For the owner and a small group of friends.

**Success looks like:** friends open the link on their phone, instantly recognise the LigaInsider structure (News → tap → full article; club → predicted XI), and the site loads fast, has no ads and looks clean in dark and light mode.

### What the user said vs. assumptions

| Said by user | Assumed (confirmed during brainstorming) |
|---|---|
| Scrape news tab + predicted XIs, host ourselves, modern design, no ads | Private use for a few friends, mobile-first |
| Keep LigaInsider's structure, no extra features | Content in German, as on the source |
| Full article text: headline list → tap → full text | New content appears within ~5–15 min |
| No password for now; accounts and comments later | Private by obscurity + `noindex` is acceptable for v1 |
| Style: dark sports app with light mode, minimal (Apple/Airbnb) | |
| Use player photos | |

### Constraints

- Content belongs to LigaInsider. The site stays **private** (not publicly listed or indexed), and every article links back to the original. A public launch is out of scope.
- Be polite to the source: low request rate, no request per page view.
- Zero or near-zero hosting cost.

## 2. Scope

**In v1**
- 1. Bundesliga only.
- **News hub:** headline list, newest first, grouped by day, with a filter (Alle / Bundesliga / Testspiele) that mirrors LigaInsider's news categories.
- **Article page:** full text, player and club, author, date and time, source ("Quelle"), and a link to the original.
- **Club pages (×18):** predicted XI on a pitch against the next opponent, plus that club's news.
- **Lineups overview:** all 18 predicted XIs for the upcoming matchday.
- Player photos and club crests, stored on our own site.
- Dark and light mode (follows the system setting, manual toggle saved in `localStorage`).

**Out of v1 (planned for later)**
- Accounts and comments (Supabase), optional login wall (Cloudflare Access).
- 2. Bundesliga, player detail pages, injury lists, market values.
- Personalisation ("my squad"), push notifications.

## 3. Architecture

```
GitHub Actions cron (every 5 min, PUBLIC repo: code only, no content in git)
  ├─ restore store/ + public/img/ from the Actions cache
  │    (cache missing → fallback: download <SITE_URL>/data/snapshot.json from our own site)
  ├─ scraper (Node + TypeScript)
  │    1. GET news overview(s) → diff article IDs against store/
  │    2. GET each new or re-titled article → parse → store/articles/<id>.json
  │    3. lineups due? (every 30 min; every 10 min within 48 h of any kickoff)
  │         → GET 18 club pages → store/lineups/<club-slug>.json
  │    4. new player photos / club crests → download once → public/img/...
  │    5. drop articles older than 30 days
  │    6. nothing changed → exit (no build, no deploy)
  ├─ save store/ + public/img/ to the Actions cache
  └─ Astro build (also writes /data/snapshot.json) → wrangler deploy to Cloudflare Pages
```

**Why a public repo:** private repos get 2,000 free Actions minutes a month, and a 5-minute cron needs about 8,600. Public repos get unlimited free minutes. The repo therefore holds **only code**. Scraped content lives in the Actions cache and on the deployed site, never in git. Scheduled workflows in public repos are paused by GitHub after 60 days without repo activity, so the workflow re-enables itself via the GitHub API once a week (keep-alive).

### Components (each one is isolated and testable)

| Unit | Responsibility | Input → Output |
|---|---|---|
| `scraper/fetch.ts` | HTTP with a normal user-agent, ~1 s delay between requests, 1 retry, timeout | URL → HTML string |
| `scraper/parse/newsList.ts` | Parse a news overview page | HTML → `ArticleRef[]` |
| `scraper/parse/article.ts` | Parse an article page (body sanitised) | HTML → `Article` |
| `scraper/parse/clubs.ts` | Find the 18 clubs on the homepage | HTML → `ClubRef[]` |
| `scraper/parse/clubPage.ts` | Parse a club page's predicted XI | HTML → `Lineup` |
| `scraper/sanitize.ts` | Reduce article body HTML to an allowlist | HTML → safe HTML |
| `scraper/validate.ts` | Sanity checks (see §5) | object → list of problems |
| `scraper/store.ts` | Read and write `store/` | — |
| `scraper/images.ts` | Download missing player photos and club crests | URLs → files in `public/img/` |
| `scraper/run.ts` | Orchestrates the steps; exits with "changed" or "unchanged" | — |
| `src/` (Astro + Tailwind) | Static pages built from `store/` | JSON → HTML |

### Data model (JSON files in `store/`, git-ignored)

```ts
type Ref = { id: number; slug: string; name: string };

type NewsType = "verletzung" | "angeschlagen" | "aufbautraining" | "fit" | "sonstiges";

type Article = {
  id: number;              // LigaInsider article id, e.g. 418778
  url: string;             // original URL (link back)
  headline: string;
  category: "bundesliga" | "testspiele";   // which overview it was listed in
  newsType: NewsType;      // from the list icon, drives the status pill
  player?: Ref;            // absent for editorial pieces ("LigaInsider")
  club?: Ref;
  author?: string;
  source?: { name: string; url: string };  // "Quelle: bild.de"
  publishedAt: string;     // ISO, from "07.10.2026 - 09:32 Uhr" (Europe/Berlin)
  bodyHtml: string;        // sanitised, allowlist: p h3 b strong i em br a[href^=http]
  fetchedAt: string;
};

type LineupPlayer = Ref & {
  photo?: string;          // local path, e.g. /img/players/9357.jpg
  status: "set" | "doubtful";
  statusLabel?: string;    // e.g. "Angeschlagen"
  alternative?: Ref & { photo?: string };
};

type Lineup = {
  club: Ref & { crest?: string };
  opponent?: { name: string; home: boolean };
  matchday?: number;
  kickoff?: string;        // ISO
  formation: string;       // derived from row sizes, e.g. "3-4-3"
  lines: LineupPlayer[][]; // lines[0] = goalkeeper … last = attack
  updatedAt: string;
};
```

Article bodies are **sanitised to a small tag allowlist**. Some articles use headings, bold text and links (e.g. press-conference schedules), so pure plain text would lose meaning. Scripts, ads (`<div id="ad_oop">`), images and attributes other than a link's `href` are stripped.

### Hosting and privacy
- Public GitHub repo containing only code. Content is never committed.
- Cloudflare Pages via direct upload (`wrangler pages deploy`) from the workflow; free.
- `<meta name="robots" content="noindex,nofollow">` on every page plus a `robots.txt` disallowing everything.
- Secrets in repo settings: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`. Variable: `SITE_URL`.

## 4. UI / design

Approved direction: **"B minimal"**, a dark sports-app feel in an Apple/Airbnb-like minimal style (mockups: `.superpowers/brainstorm/*/content/style-v2.html`).

- System font stack (`-apple-system, …, Inter`), large bold titles, generous whitespace, hairline separators.
- Colours follow iOS system colours. Dark: background `#000`, surfaces `#1c1c1e`. Light: `#fff` / `#f2f2f7`. One accent colour, green (`#30d158` dark / `#248a3d` light).
- Status pills from LigaInsider's news icons: Verletzung (red), Angeschlagen (yellow), Aufbautraining and Fit (green). "Sonstiges" shows no pill.
- Bottom tab bar on mobile: **News · Aufstellungen · Vereine**. Wider screens get a centered column, max ~720px.
- Pitch view: light pitch, round player photos (initials as fallback) with a status dot (green = set, yellow = doubtful), short name, and "Alt: X" when LigaInsider names an alternative.
- Footer: "Stand: <last update>", plus "Inhalte von ligainsider.de" with a link.
- Language: German UI labels, matching the source.

## 5. Error handling

- **Validation before writing:** an article needs an id, a headline, a valid date and a non-empty body. A lineup needs exactly 11 players, one goalkeeper line of size 1. On failure, keep the last good file, log the failure, and exit non-zero, so GitHub emails the owner.
- **Network errors:** one retry with backoff, then skip until the next run. One failing item doesn't block the others.
- **Blocked by the source:** the site keeps serving the last good data, and the footer timestamp makes staleness visible.
- **Edited articles:** re-fetch when a known article's headline changes in the overview.
- **Retention:** articles older than 30 days are deleted from `store/`.
- **Lost cache:** if the Actions cache is evicted, the scraper restores `store/` from `<SITE_URL>/data/snapshot.json` and re-downloads images as needed. If that also fails, it starts fresh and backfills 3 overview pages.
- **Missing images:** fall back to initials or the club colour.

## 6. Testing

- **Parser unit tests (Vitest)** run against saved real pages in `scraper/__fixtures__/` (news overview, ≥2 articles, ≥2 club pages). No network calls in tests.
- **Validation tests:** malformed input is rejected.
- **Change detection test:** no new IDs → no writes, run reports "unchanged".
- **Build check:** `astro build` succeeds on the fixture data (runs in CI).
- **Manual check:** phone, dark and light, before the first deploy.

## 7. Future: accounts and comments (not v1, but designed for)

- Supabase (Auth with magic link or Google, Postgres for comments), called from a small client-side component on article pages, keyed by `article.id`.
- Row-level security: anyone signed in can read, and only the author can edit or delete their own comment. Sign-up is limited to an invite list.
- No changes to the scraper or static pages are needed beyond adding that component.
