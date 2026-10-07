# tonisInsider — Design Spec

**Date:** 2026-10-07
**Status:** Draft, awaiting review

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
GitHub Actions cron (every 5 min, private repo)
  └─ scraper (Node + TypeScript)
       1. GET news overview → diff article IDs against data/articles/
       2. GET each new article → parse → data/articles/<id>.json
       3. lineups due? (every 30 min; every 10 min within 48 h of a club's kickoff)
            → GET 18 club pages → data/lineups/<club-slug>.json
       4. new player/club images → download once → public/img/...
       5. nothing changed → exit (no commit, no deploy)
  └─ commit changed data → Astro build → deploy to Cloudflare Pages
```

### Components (each one is isolated and testable)

| Unit | Responsibility | Input → Output |
|---|---|---|
| `scraper/fetch.ts` | HTTP with a normal user-agent, ~1 s delay between requests, 1 retry, timeout | URL → HTML string |
| `scraper/parse/newsList.ts` | Parse the news overview | HTML → `ArticleRef[]` (id, url, headline, player, club, time) |
| `scraper/parse/article.ts` | Parse an article page | HTML → `Article` |
| `scraper/parse/clubPage.ts` | Parse a club page's predicted XI | HTML → `Lineup` |
| `scraper/validate.ts` | Sanity checks (see §5) | object → ok / error |
| `scraper/images.ts` | Download missing player photos and club crests | URLs → files in `public/img/` |
| `scraper/run.ts` | Orchestrates the steps; writes JSON only when something changed | — |
| `site/` (Astro + Tailwind) | Static pages built from `data/` | JSON → HTML |

### Data model (JSON files in git)

```ts
type Article = {
  id: number;            // LigaInsider article id, e.g. 418778
  url: string;           // original URL (link back)
  headline: string;
  category: "bundesliga" | "testspiele" | "other";
  player?: { id: number; name: string; slug: string };
  club?: { id: number; name: string; slug: string };
  author?: string;
  source?: string;       // "Quelle: bild.de"
  publishedAt: string;   // ISO
  paragraphs: string[];  // plain text paragraphs, no source HTML
  fetchedAt: string;
};

type Lineup = {
  club: { id: number; name: string; slug: string };
  opponent?: { name: string; slug: string; home: boolean };
  matchday?: number;
  kickoff?: string;      // ISO
  formation?: string;    // e.g. "3-4-2-1"
  players: Array<{
    id: number; name: string; slug: string;
    position: { x: number; y: number };     // 0..1 pitch coordinates
    status: "set" | "doubtful" | "out";      // as shown by LigaInsider
    alternative?: { id: number; name: string };
  }>;
  updatedAt: string;
};
```

Article bodies are stored as **plain-text paragraphs**, never as raw source HTML. Our site then shows no foreign markup or scripts.

### Hosting and privacy
- Private GitHub repo (the scraped content is never public on GitHub).
- Cloudflare Pages (free; deploys from a private repo).
- `<meta name="robots" content="noindex,nofollow">` on every page plus a `robots.txt` disallowing everything.

## 4. UI / design

Approved direction: **"B minimal"**, a dark sports-app feel in an Apple/Airbnb-like minimal style (mockups: `.superpowers/brainstorm/*/content/style-v2.html`).

- System font stack (`-apple-system, …, Inter`), large bold titles, generous whitespace, hairline separators.
- Colours follow iOS system colours. Dark: background `#000`, surfaces `#1c1c1e`. Light: `#fff` / `#f2f2f7`. One accent colour, green (`#30d158` dark / `#248a3d` light).
- Status pills: Verletzt (red), Fraglich (yellow), Comeback (green), shown only when LigaInsider provides the status.
- Bottom tab bar on mobile: **News · Aufstellungen · Vereine**. Wider screens get a centered column, max ~720px.
- Pitch view: light pitch, round player photos (initials as fallback) with a status dot, short name, and "Alt: X" for doubtful players.
- Footer: "Stand: <last update>", plus "Inhalte von ligainsider.de" with a link.
- Language: German UI labels, matching the source.

## 5. Error handling

- **Validation before writing:** an article needs an id, a headline and ≥1 paragraph. A lineup needs exactly 11 players with positions. On failure, keep the last good file, log the failure, and exit non-zero, so GitHub emails the owner.
- **Network errors:** one retry with backoff, then skip until the next run. One failing item doesn't block the others.
- **Blocked by the source:** the site keeps serving the last good data, and the footer timestamp makes staleness visible.
- **Edited articles:** re-fetch when a known article's headline changes in the overview.
- **Retention:** the feed shows articles from the last 30 days. Older JSON is deleted by the scraper.
- **Missing images:** fall back to initials or the club colour.

## 6. Testing

- **Parser unit tests (Vitest)** run against saved real pages in `scraper/__fixtures__/` (news overview, ≥2 articles, ≥2 club pages). No network calls in tests.
- **Validation tests:** malformed input is rejected.
- **Change detection test:** no new IDs → no writes.
- **Build check:** `astro build` succeeds on the fixture data (runs in CI).
- **Manual check:** phone, dark and light, before the first deploy.

## 7. Future: accounts and comments (not v1, but designed for)

- Supabase (Auth with magic link or Google, Postgres for comments), called from a small client-side component on article pages, keyed by `article.id`.
- Row-level security: anyone signed in can read, and only the author can edit or delete their own comment. Sign-up is limited to an invite list.
- No changes to the scraper or static pages are needed beyond adding that component.
