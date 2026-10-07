# Mein Team (Kickbase login) — Design Spec

**Date:** 2026-10-07
**Status:** Approved in conversation, awaiting written-spec review
**Builds on:** `2026-10-07-tonisinsider-design.md`

## 1. Goal

Friends log in with their **Kickbase** account and get a **Mein Team** page: their Kickbase squad with each player's predicted starting chance from LigaInsider, plus only the news about their players. They no longer need to scroll the whole feed.

Kickbase stays the place for market values and points. This page only adds what LigaInsider knows on top.

### What the user said vs. assumptions

| Said by user | Assumed (confirmed in conversation) |
|---|---|
| Login with Kickbase credentials | Anyone with the site link and a Kickbase account may log in |
| Show squad + how likely players start + their news (option A) | No Kickbase market value or points shown |
| League switcher when in several leagues (option A) | Last chosen league remembered in a cookie |
| Server rendering on the Cloudflare Worker (approach 1) | Session lasts as long as Kickbase's token (`tknex`) |
| Remove the Vereine tab (same data as Aufstellungen → team) | Club pages stay at `/vereine/<slug>/`, reached from Aufstellungen |
| Page transitions feel buggy | Fixed first, as a small separate change |

### Constraints

- **Passwords are never stored or logged.** They are only passed through to Kickbase. Only the Kickbase token is kept, in an HttpOnly cookie.
- **No database and no user data on our side.** The cookie is the whole session.
- **Unofficial API:** Kickbase may change it or object to automated access. Keep Kickbase calls minimal (3 per visit) and degrade gracefully.
- **Repo stays public and code-only.** Test credentials live in `.env` (git-ignored); recorded Kickbase responses live in git-ignored fixtures.

## 2. Scope

**In**
- Transition fix: no stacked or replayed animations on navigation.
- Tab bar: **News · Aufstellungen · Mein Team** (the label reads **Login** when logged out). Remove `/vereine/` (the list page) and its tab.
- `/login/`: Kickbase email and password form, plus a privacy sentence.
- `/api/login` (POST) and `/api/logout` (POST).
- `/mein-team/`: rendered on request.
  - League switcher.
  - Squad grouped TW / ABW / MF / ST, each row with photo, name, club crest, start badge and next opponent.
  - News about the squad's players.
  - Logout button.

**Out**
- Comments (a later feature; the Kickbase user id will be the identity).
- Market values, points, lineup suggestions, push notifications.
- Storing anything per user on the server.

## 3. Architecture

```
Browser ──► Cloudflare Worker (Astro + @astrojs/cloudflare, static pages prerendered)
  /, /news/*, /artikel/*, /aufstellungen/, /vereine/<slug>/, /login/   prerendered (as today)
  POST /api/login   → POST https://api.kickbase.com/v4/user/login {em, pass}
                      200 → Set-Cookie kb=<tkn>; HttpOnly; Secure; SameSite=Lax; Path=/; Expires=<tknex>
                           → 303 /mein-team/
                      401 → 303 /login/?error=credentials
                      other → 303 /login/?error=unavailable
  POST /api/logout  → clear kb and kbleague cookies → 303 /
  GET  /mein-team/  (on demand)
       no kb cookie → 302 /login/
       GET /v4/leagues/selection                         → leagues
       league = ?league= | kbleague cookie | first        → Set-Cookie kbleague (not HttpOnly-sensitive)
       GET /v4/leagues/{league}/squad                     → players
       GET /v4/competitions/1/table (cached 24 h)         → Kickbase team id → short club name
       GET <own origin>/data/snapshot.json (via ASSETS)    → lineups + articles
       Kickbase 401 → clear kb, 302 /login/?error=expired
       Kickbase other failure → render page with "Kickbase gerade nicht erreichbar"
```

The scraper workflow is unchanged, except the deploy step. It now deploys the Astro Cloudflare build, the Worker plus static assets, with the same `wrangler deploy --name` and the name from the repo variable.

### Units

| Unit | Responsibility |
|---|---|
| `src/lib/kickbase.ts` | Typed Kickbase client: `login`, `leagues`, `squad`, `clubTable`. Takes `fetch` as a parameter (testable). Throws `KickbaseAuthError` on 401. |
| `src/lib/match.ts` | Pure functions: `normalize`, `mapClubs(table, lineups)`, `matchSquad(squad, clubMap, lineups, articles)` → `MyPlayer[]` and `MyNews`. |
| `src/lib/session.ts` | Cookie names and options; `isSameOrigin(request)` for the CSRF check. |
| `src/pages/api/login.ts`, `src/pages/api/logout.ts` | Endpoints (`prerender = false`). |
| `src/pages/mein-team.astro` | Page (`prerender = false`). |
| `src/components/StartBadge.astro`, `src/components/MyPlayerRow.astro` | UI. |

### Matching rules

- **`normalize`:** lowercase, accents removed (NFD), "ß" → "ss", and everything except a–z, 0–9 and spaces removed.
- **Club mapping:** a Kickbase short name maps to the LigaInsider club whose normalised name contains it as a word sequence; the alias table covers exceptions (`m gladbach` → `borussia-moenchengladbach`, `hsv` → `hamburger-sv`, plus any others found in the recorded table). Every Kickbase team must map to exactly one club, and a test enforces this against the recorded table.
- **Player matching (within the mapped club only):** candidates are every player and alternative in that club's predicted lineup. A Kickbase name `n` matches a candidate when:
  - `normalize(n)` equals the normalised candidate name, or
  - it equals the candidate name's last word, or
  - its words appear in order inside the candidate's slug, split on "-".

  If more than one candidate matches, the result is unmatched.
- **Start status:**
  - `start`: in the XI and set
  - `doubtful`: in the XI and doubtful (with its label)
  - `alternative`: only listed as someone's alternative
  - `bench`: the club has a lineup but the player isn't in it
  - `unknown`: unmatched, or no lineup for the club
- **News:** articles whose `player.slug` belongs to a matched player, plus articles whose `player.name` normalises to a squad player's name at the same club (this catches players who aren't in any lineup), newest first.

## 4. UI

- **Same visual language as the existing pages:** start badges reuse the pill colours (green start, yellow doubtful/alternative, grey bench/unknown).
- **Squad row:** player photo (from LigaInsider if matched, otherwise Kickbase's `pim` image), name, crest, badge, and "vs Werder · Fr 20:30".
- **League switcher:** the same segmented control as the news tabs, shown only when there is more than one league.
- **Login page:**
  - Two fields and a button.
  - The sentence "Dein Passwort wird nur an Kickbase weitergeleitet und nirgends gespeichert."
  - Error messages for `?error=credentials`, `expired` and `unavailable`.

## 5. Errors and security

- **CSRF:** `/api/login` and `/api/logout` reject requests whose `Origin` doesn't match the site (403).
- **No secrets in logs:**
  - The login request body is never logged.
  - Kickbase error bodies are never forwarded to the client.
  - Tokens are never put in URLs.
- **Cookies:** `kb` is HttpOnly, Secure and SameSite=Lax and expires at `tknex`. `kbleague` holds only a league id.
- **Kickbase calls** time out after 8 s.
- **Missing data:** if `snapshot.json` is missing, the page still lists the squad, with every badge `unknown`.

## 6. Testing

- **Unit tests (Vitest):**
  - `normalize`, `mapClubs` and `matchSquad` against recorded fixtures: `kickbase-table.json`, `kickbase-squad.json` and our snapshot.
  - Status mapping for each case, ambiguous names, players missing from lineups, and the news filter.
- **Kickbase client:** tested with a fake `fetch`. Covers 401 → `KickbaseAuthError`, timeouts, and the exact request bodies and headers.
- **Endpoints:** a CSRF rejection test and a cookie attributes test.
- **End to end (manual, locally with `.env` credentials):** log in, view Mein Team, switch league, log out, and confirm that wrong-password and expired-token paths behave as specified.
- **Fixtures:** recorded once from the test account via a small script. They're git-ignored, like the LigaInsider fixtures.
