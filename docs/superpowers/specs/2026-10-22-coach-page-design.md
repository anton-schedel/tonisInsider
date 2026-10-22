# Coach page for TuS Schnöselmob

Date: 2026-10-22. Status: design approved in chat, awaiting spec review.

## Goal

The coach of TuS Schnöselmob writes and schedules the club's posts (lineups, results, player news) on
TonInsider without going through the site owner. Posts look and behave exactly like the own posts written by
hand so far (`content/posts/*.json`).

Success: the coach opens the page on their phone, enters the password once, writes a lineup, picks "Sa. 19:00",
and the post appears in the feed at 19:00, pinned for an hour.

Out of scope (later): bot comments under coach posts, with an on/off switch per post.

## What the coach sees: `/schnoeselmob/`

Rendered by the Worker (not prerendered), `noindex`, not in the tab bar.

- **Login.** One password field. The password is the Worker secret `COACH_PASSWORD`. A correct password sets a
  cookie `coach` holding an expiry and an HMAC over it (key: the existing `CREDENTIALS_KEY`), valid 90 days,
  `HttpOnly; Secure; SameSite=Lax`. Wrong password: "Falsches Passwort." Five wrong tries per IP in 10 minutes
  are refused for 10 minutes.
- **Overview.** The coach posts, newest first: headline, type, status ("Geplant: Sa. 24.10. 19:00" or "Live
  seit …"), Edit and Delete (with a confirm). Button "Neuer Beitrag".
- **Editor.** Type picked first (segmented control):
  - **Aufstellung:** fields Coach/Tor, Abwehr, Mittelfeld, Sturm (each a comma-separated list of names) and
    Bank. Headline prefilled "Aufstellung des TuS Schnöselmob". Optional text.
  - **Ergebnis:** opponent, our goals, their goals, home/away, headline, text.
  - **Spielernews:** player name, badge (the existing news types: Angeschlagen, Verletzung, Fit, …), headline,
    text, optional photo. The photo is shrunk in the browser to at most 1200 px on the long side (JPEG, q 0.82)
    before upload; the feed avatar is a centred square crop of it.
  - **For every type:** publish "Jetzt" or at a date and time (Europe/Berlin); "Oben anheften" for 0–24 hours
    (default 1); a live preview of the feed row (the same markup as `ArticleRow`).
- Saving shows "Gespeichert. Erscheint um 19:00." or, for an edit of a live post, "Gespeichert. In ein paar
  Minuten auf der Seite." Errors keep the form as typed and say what failed.

The page follows the site's look (light/dark, `.seg`, the same fields and buttons as Einstellungen).

## Data

New D1 migration `migrations/0003_coach_posts.sql`:

```sql
CREATE TABLE coach_posts (
  id INTEGER PRIMARY KEY,          -- 900001000 and up, so they never collide with LigaInsider ids or content/posts
  type TEXT NOT NULL,              -- 'lineup' | 'result' | 'player'
  data TEXT NOT NULL,              -- JSON: the editor's fields (CoachPostData, see below)
  published_at TEXT NOT NULL,      -- ISO, UTC
  pinned_until TEXT,               -- ISO or NULL
  image_id TEXT,                   -- coach_images.id or NULL
  updated_at TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE coach_images (
  id TEXT PRIMARY KEY,             -- random 16 hex chars
  type TEXT NOT NULL,              -- 'image/jpeg'
  body BLOB NOT NULL,              -- at most 600 KB
  created_at TEXT NOT NULL
);
```

`CoachPostData` (TypeScript, in `src/lib/coachPosts.ts`):
`{ headline, text?, lineup?: { lines: string[][], bench: string[] }, result?: { opponent, ours, theirs, home },
player?: { name, newsType } }`.

## Worker API (`src/pages/api/coach/`)

All but `login` require a valid `coach` cookie, else 401.

- `POST /api/coach/login` `{ password }` → sets the cookie.
- `GET /api/coach/posts` → the coach's posts (not deleted).
- `POST /api/coach/posts` `{ type, data, publishedAt, pinnedHours }` → creates; validates (headline 3–140
  chars, lineup has at least one line with a name, score 0–99, time not more than 60 days ahead).
- `PUT /api/coach/posts/:id` → same body, replaces. `DELETE /api/coach/posts/:id` → sets `deleted = 1`.
- `POST /api/coach/images` (JPEG body, ≤ 600 KB) → `{ id }`.
- `GET /api/coach/export` with header `x-export-token: <COACH_EXPORT_TOKEN>` → every post (deleted ones as
  `{ id, deleted: true }`) and the image ids. Used by CI only; the token is a secret in both Cloudflare and
  GitHub.
- `GET /api/coach/images/:id` with the same token → the image bytes.

## From D1 into the site

- **Scrape step** (`scraper/cli.ts`): when `COACH_EXPORT_URL` and `COACH_EXPORT_TOKEN` are set, fetch the
  export, download images that aren't in `public/img/custom/coach/` yet, and write `store/coach-posts.json`.
  A changed export (hash over posts, incl. `updated_at`) marks the run as changed, so it rebuilds and deploys.
  A failed fetch keeps the last `store/coach-posts.json` and doesn't fail the run.
- **Conversion** (`src/lib/coachPosts.ts`, pure, unit-tested): `toArticle(post): Article` builds the same shape
  as `content/posts/*.json`: club TuS Schnöselmob, `own: true`, `source: TonInsider`, the URL slug from the
  headline, the body HTML from the fields (lineup as "Startelf: … Bank: …" like today's posts, so
  `confirmedLineup` shows the XI in the feed), banner `/img/custom/schnoeselmob-banner.jpg` or the photo.
  Text is HTML-escaped; line breaks become paragraphs.
- **`src/lib/data.ts`** loads `store/coach-posts.json` next to `content/posts/`.
- **Exact timing.** Posts due within the next 7 days are built in advance. In the feed, rows of a post whose
  `publishedAt` is in the future carry `data-show-after` (the existing hide-until mechanism in `NewsFeed`), and
  the pinned row too, so the post appears at the planned minute without a rebuild. The article page of a
  future post exists but isn't linked anywhere before its time.
- Edits and deletes appear with the next run (about 5–8 minutes).
- The existing `content/posts/*.json` posts stay as they are.

## Errors

- Wrong or expired cookie: the page shows the login again; the form keeps what was typed.
- Save fails (network, validation): message with the reason, nothing lost.
- Image too big after shrinking or not JPEG: "Bild zu groß" / "Nur Fotos (JPEG)".
- CI export fails: last known posts are kept; logged, the run continues.

## Testing

- Unit: `toArticle` for each type (body HTML, escaping, slug, pin, banner/photo), the validation, the cookie
  signing and expiry, the export hash.
- API: login (right, wrong, rate limit), create/edit/delete with and without cookie.
- Manual on the live site: a lineup scheduled two minutes ahead appears on time and pinned; an edit and a delete
  show up after the next run; light and dark at 390 and 360 px.

## Setup the owner does once

- `npx wrangler secret put COACH_PASSWORD` and `COACH_EXPORT_TOKEN` (Cloudflare).
- GitHub secrets `COACH_EXPORT_TOKEN` and `COACH_EXPORT_URL`.
- Apply the migration: `npx wrangler d1 execute COMMENTS --remote --file migrations/0003_coach_posts.sql`.
