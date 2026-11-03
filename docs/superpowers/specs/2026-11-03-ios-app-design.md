# TonInsider iOS app — design

## Intent

Toni and a handful of friends use TonInsider every day from the home screen (as a web app). It works, but it
never feels like a real app: every tap loads a new page from the Worker, there's a short flash, swipe-back is
Safari's, scroll position is lost. Kickbase's native app — which talks to the same Kickbase API — feels faster
and smoother. The goal is the same TonInsider, native for iOS, so that moving between tabs, articles and the
lineups feels as instant as Kickbase.

It is for private use: first on Toni's own iPhone (free Apple ID, run from Xcode), later shared with friends
via internal TestFlight on a friend's paid developer account (up to 100 testers, no App Review).

## Goals

- A native SwiftUI app with the website's tabs and screens (below), the same content and the same calm design.
- Instant navigation: the last data is kept on the phone and shown at once; fresh data arrives quietly in the
  background (stale-while-revalidate), never a blank screen while a request runs.
- Native navigation: tab bar, navigation stacks with the system swipe-back, scroll position kept per tab.
- Writing works from day one: comments and votes in articles (LigaInsider threads and our own posts), polls on
  our own posts, the scout list.
- One source of truth for Mein Team: the web page and the app get their data from the same server function.

## Non-goals (for now)

- The /schnoeselmob page, the coach pages (/api/coach/…) and anything only the coach uses.
- Push notifications (wanted later: e.g. a lineup confirmed with one of your players, a player dropping out of the
  predicted XI before Kickbase locks). The design shouldn't block them, nothing more.
- Android, iPad-specific layouts, widgets, Live Activities.
- App Store release.

## Anti-goals

- **The website must not change.** No page may look or behave differently, no endpoint may change its
  behaviour. The server only gains new endpoints for the app (and Mein Team's data loading moves into a shared
  function the page calls, with identical output).
- Not a WebView wrapper around the site — that is exactly what doesn't feel native.
- No passwords on the device in plain form and none in logs; never commit credentials, signing data or the
  team id of the friend's account.
- No "AI-looking" design: no stat cards, no colour tints, no gradients (see the owner's taste below).

## Screens (same as the web, minus the excluded pages)

1. **News** (`/`, `/news/aeltere/`): the feed with day bands, pinned posts, lineup posts; tapping opens the
   article. Older news below.
2. **Article** (`/artikel/[id]/`): header with player/club, text, ratings pitch where present, comments
   (LigaInsider thread or our own post's comments with votes and polls), link to the club's lineup.
3. **Aufstellungen** (`/aufstellungen/`) and **club page** (`/vereine/[slug]/`): predicted/confirmed lineups per
   club on a pitch, the club's news.
4. **Mein Team** (`/mein-team/`): the Kickbase lineup on the pitch, player rows/cards, the matchday summary
   (TeamSummary), live points while games run, league switch.
5. **Scouting** (`/scouting/`): the scout list and "Gerade in den News".
6. **Einstellungen** (`/einstellungen/`): Kickbase login/logout, LigaInsider login/logout, appearance.

Same tab order and labels as the web: News, Aufstellungen, Mein Team, Scouting, Einstellungen.

## Data — what exists and what's new

**Public, read directly by the app:**
- **`app-feed.json` (new, written at build time next to the snapshot):** the finished feed as the web builds it in
  `src/lib/data.ts` — LigaInsider articles plus our own posts (`content/posts/`) and the coach's Schnöselmob posts
  (`store/coach-posts.json`), with the pinned posts. Schnöselmob posts stay in the feed with their comments, votes
  and polls, as on the web; only the /schnoeselmob page itself is left out. Adding this file is not a change to
  the website (decided). Its own version/hash must change whenever any post changes, since `version.json` only
  tracks LigaInsider's newest article.
- `snapshot.json` (`public/data/snapshot.json`, ~440 KB, refreshed by the scraper every 5 min; `version.json`
  tells whether it changed): articles, lineups, state (odds, predictions, …). The app downloads it, stores it on
  disk, renders News, Article, Aufstellungen, club pages and the scouting news from it, and checks
  `version.json` when the app becomes active and on pull-to-refresh.
- Logic the website does in TypeScript on this data (feed ordering, day bands, `pinnedArticles`, lineup news,
  player matching) is either re-implemented in Swift or served precomputed by a new endpoint. **Builder's call,
  per screen** — prefer a server endpoint where the logic is non-trivial and already tested in TS, so the two
  can't drift.

**Existing JSON endpoints the app uses as they are (behaviour unchanged):**
- `/api/comments/[id]`, `/api/comments/[id]/more` — LigaInsider threads.
- `/api/li-comment` — write/vote in LigaInsider threads.
- `/api/own-comments/[id]`, `/vote`, `/poll-vote` — our own posts.
- `/api/scout` — the scout list.
- `/api/kickbase/live`, `/api/kickbase/player/[id]`, `/api/kickbase/club/[slug]` — live points and details.

**New:**
- **Mein Team data**: move the data part of `src/pages/mein-team.astro` (Kickbase squad and eleven, matching
  with LigaInsider, odds/insights, the summary from `summaryInput`/`summaryView`, live state) into one server
  function, e.g. `myTeamData(...)`. The page calls it and renders exactly what it renders today; a new
  `/api/app/my-team` returns the same data as JSON.
- **App login**: the web's logins are cookie-based and every write checks `isSameOrigin` (an `Origin` header
  equal to the site). The app needs its own way in that doesn't loosen the web's checks: new app login
  endpoints that return a session token, sent by the app as `Authorization: Bearer …`, kept in the iOS Keychain.
  Decided: the token carries the same sealed credentials as the web's "stay logged in" cookies (`kbc`/`lic`,
  AES-GCM with `CREDENTIALS_KEY`, which only the Worker holds) — equally safe as the cookie already on the phone in
  Safari, stateless, quiet re-login like `relogin`/`callLiga`, and the scout list stays under the same owner
  (`scoutOwner` hashes the Kickbase email) as on the web. The existing
  endpoints above accept either the web cookie (as now) or the app token. Exact mechanism is the builder's
  call within these rules: the web behaves exactly as before; no password ever stored on the phone in readable form; a bearer
  token is not a CSRF vector, so the same-origin check applies only to cookie requests.
- Anonymous identity for votes (`voterOf`) works for the app the same way it does for a browser (a stable id
  stored on the device).

## How it gets made (decided)

- **SwiftUI**, iOS 27 minimum, built with Xcode 27 (Toni's iPhone 15 runs iOS 27.0.1; friends need iOS 27 too).
  Native tab bar and navigation stacks; the system's glass tab bar stands in for the web's glass pill.
- In this repo under `ios/`, project generated with **XcodeGen** (`project.yml`, already installed), so the
  project file isn't hand-edited. Signing team and bundle id prefix come from a git-ignored local config file;
  nothing account-specific is committed (the repo is public).
- **Analytics:** the PostHog iOS SDK (free, same project as the web), screen views and the same login events as
  the web. Low priority: the last piece of work, dropped if it causes trouble.
- No other third-party Swift packages unless one clearly pays for itself (image caching may; `AsyncImage` doesn't
  cache well).
- First builds run on Toni's iPhone with his free Apple ID (7-day signing, fine for development). TestFlight
  comes later on the friend's account; the setup must make switching the team a one-line change.
- Server changes in the existing Astro/Worker code with Vitest tests, same conventions as today.

## Design

The owner's taste (from the web app, kept): plain, Apple-like, smooth and calm beats effects. Liked: the glass
tab bar, the grass-green pitch, skeletons, photos fading in, instant feedback on buttons, the matchday rows (crest,
win %, slim bar gold from 55 %). Rejected: club-colour tints, stats cards ("looks cheap and AI design"), large
headings with rules. Gold accent, light and dark mode. German UI copy, same wording as the site.

Native means: system fonts and controls where they fit, SF Symbols for the tab icons, system swipe-back, haptics
on votes, pull-to-refresh, no custom transitions that fight the system ones.

## Success

Toni opens the app from the home screen and News is there instantly; switching tabs and opening/closing articles
feels as fast as Kickbase; he can comment and vote; Mein Team shows the same as the website. Then friends get it
through TestFlight.

## Left to the builder

- Swift architecture (observable stores, caching layer, file layout).
- Which feed/lineup logic is ported to Swift vs. served by new endpoints (see above).
- The exact app token design within the rules above.
- Image caching approach.
- Order of work — but a first runnable slice on the iPhone (News + Article from the snapshot) should come early,
  so the feel can be judged before everything is built.
