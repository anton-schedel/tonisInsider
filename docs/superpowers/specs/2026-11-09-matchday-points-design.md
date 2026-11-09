# Matchday points everywhere, substitutes in sight, grades in the match reports

Date: 2026-11-09 · Status: draft for the owner's review

## Why

On a matchday the owner and a friend follow their Kickbase points in TonInsider. Three things get in the way:

1. **The iPhone app shows less than the website.** The app's club pages (Aufstellungen → a club) have no
   Kickbase points at all, the points it does show (Mein Team) are plain white numbers, and its player card
   has no "Punkte am Spieltag" (what he did, what each action was worth). The website has all three.
2. **Substitutes hide behind a flip.** On a club page, from kickoff, a substituted starter's face gets the ⇄
   mark and flips to the player who came on. The friend didn't find which face to "turn around" to see a
   substitute's points.
3. **The grades never arrive.** LigaInsider's match reports carry a grades pitch per team ("Aufstellung
   von …", a grade on every player). TonInsider already draws it in an article (website `RatingsPitch.astro`,
   app `RatingsPitch.swift`), but almost no article has it: of 1,301 articles in the live snapshot only 4
   carry grades, while the last matchday's reports ("BVB zittert sich zum 2:1 gegen Elversberg", "Leipzig
   schlägt Augsburg …", "HSV schlägt Gladbach …") have none. Cause: the scraper reads a report minutes after
   the final whistle, when LigaInsider's page has only the bare headings (`<h3>Aufstellung von Borussia
   Dortmund</h3><h3></h3>`); the grades are filled in later, and the scraper never reads the article again
   (its headline doesn't change; the old re-read rule only looks for "PARADEN|DEFENSIVE").

Success: on a matchday the app shows the same points as the website, every substitute's points are visible
on a club page without tapping, and every match report that LigaInsider grades shows its grades pitch in the
article on both website and app.

## Goals

### 1. Points in the app, as on the website

- **Club pages in the app** get the Kickbase points under each player's photo from kickoff on, as the
  website's club page does (`src/pages/vereine/[slug].astro`): from `GET /api/kickbase/club/<slug>/`
  (public, our shared Kickbase account, edge-cached 30 s while live, 5 min once over).
  - Polled every 30 s while the match runs and the screen is visible; not polled before kickoff or after.
  - Once the match is over the points stay until the matchday ends — the website's rule: from kickoff until the
    next matchday's lineup replaces this one (the site caps it at 4 days after kickoff).
  - From kickoff the predictions go, as on the website: no "Alt: …"/"statt …" notes, no alternative flip;
    if it was the alternative who started, his face takes the slot (`SlotPlay.show == "alt"`).
- **The points chip looks like the website's** (`global.css` `.kb-points`, `.pts-*`): a dark chip on the
  pitch, the number in Kickbase's colour step (red below 0, orange to 99, light green 100–199, green
  200–399, gold from 400), a pulsing dot in the number's colour while his match runs (no pulse under reduced
  motion). On Mein Team's bench rows the website's row chip (`.is-row`: light background, darker number
  colour). Used on Mein Team and on club pages in the app, so both screens match the website.
- **"Punkte am Spieltag" in the app's player card**: when the tapped player shows points (from kickoff on),
  his card shows the breakdown from `GET /api/kickbase/player/<Kickbase id>/` instead of the odds stats, as
  the website's card does (`PlayerCard.astro` `fillBreakdown`): biggest effect first, six lines and
  "Alle N Aktionen" for the rest, placeholders while it loads, back to the odds if Kickbase fails. As on the
  website, the card's big number then is his points, captioned "Punkte". Works on Mein Team (the player id
  there is the Kickbase id) and on club pages (the club answer's `ids` and each substitute's Kickbase id);
  the app's card data gains the Kickbase id. The app's requests share the website's edge cache (keyed by URL):
  no extra Kickbase load.

### 2. Substitutes under the pitch (club pages, website and app)

- From kickoff, every player who came on for this club is shown **right under the pitch**, visible without
  tapping: his photo, name, "63' für Guirassy" (minute and whom he replaced), and his points chip. Ordered by
  the minute he came on. Tapping one opens his card (with his breakdown).
  - Data: today `ClubPoints.slots[*].sub` holds only the first substitution of a predicted starter's slot, so a
    substitute for an unpredicted starter, or a second one in a slot, is missing. The club answer gains a
    `subs` list with every substitution of the club (from `matchDetails`, already fetched: no new Kickbase
    call), each with his Kickbase id, name, photo, minute, whom he replaced, and points.
  - On a first visit mid-match nothing is stored yet: the row appears with the first answer and pushes what
    follows down once, without animation (space can't be reserved for a row that may stay empty).
- The flip for substitutes goes away: the replaced starter stays on the pitch as one plain face, with his
  note "bis 63' · Kleindienst". Before kickoff the alternative flip (LigaInsider's prediction) stays as it is.
- No substitutions yet: nothing is shown under the pitch (no empty heading).

### 3. Grades in the match reports (scraper)

- **A report waiting for its grades**: a stored article without grades whose body has a grades heading
  (`<h3>Aufstellung (von|vom|der|des) …</h3>`, sometimes ending in ":") followed by nothing but whitespace,
  `<br>` and empty `<h3></h3>` up to the next such heading or the end of the body. Parsed `ratings` in which
  no player has a grade count as not in yet.
  - Live snapshot (2026-11-09): 36 reports since mid-October have exactly this form (Bundesliga, Pokal,
    Champions League; one or two headings); one report got its grades at its first read. Reports whose
    lineup follows the heading as plain text (6 of them, some Pokal/CL games) are not waiting: they're left
    alone.
  - The scraper reads a waiting report again until its grades are there — from the URL stored with the
    article, not from the news list (a report drops off the list's first page within hours on a matchday).
  - Only while it is young: up to 3 days after it was published; at most once every 30 minutes per article
    (the scraper runs every 5 minutes) — a handful of extra requests per matchday.
  - **Catch-up once**: on the first run with this change, every waiting report still in the store (30-day
    retention, ~36 now) is read again once, whatever its age. This also tells us at once whether LigaInsider
    fills the grades in later; if the catch-up brings none, the cause is a different one and the owner hears
    about it before anything else is changed.
  - A re-read that still finds no grades changes nothing (no rebuild, no deploy). When the grades come in,
    the article is stored with them (photos and crests fetched as today), and the website and the app show
    the grades pitch with no further change.
- While a report waits, readers don't see the bare headings: the website's article page and the app's feed
  leave the empty "Aufstellung von …" headings (and the empty `<h3></h3>` after them) out, at build time.
  The stored body keeps them, so the scraper can still tell the report is waiting.

## Non-goals

- No grades on club pages, Mein Team or anywhere outside the articles (the owner: "they should just come in
  the articles and afterwards we don't need them").
- No reading of LigaInsider's `/bundesliga/noten/` pages or the club page's matchday grades pitch.
- Mein Team's bench stays where it is (its rows already show each player's points without a flip).
- No change to how the website's club page fetches or caches points; no new Kickbase calls per viewer.

## Anti-goals

- The app or the website loading slower on a matchday: polling only while a match runs and the screen is
  visible; the first screen draws from what's stored, points fill in place (no jumps: placeholders where
  chips will be, as on the website).
- Extra load on LigaInsider beyond the throttled re-reads above.
- Anything moving or blinking beyond the live dot and the one-time fill of a changed number.

## Constraints

- Website: Astro on a Cloudflare Worker, free plan (~10 ms CPU per request) — no new per-request parsing.
- App: SwiftUI, iOS 27, Swift 6, Swift Testing; same design tokens as the website (light and dark).
- Scraper: GitHub Actions every ~5 min (`scraper/run.ts`); the re-read throttle survives between runs (the
  scraper's stored state).
- TDD for every behaviour (vitest for website and scraper, Swift Testing for the app).
- Repo is public: nothing account-specific committed. The site URL stays in the git-ignored
  `ios/Config/Local.xcconfig`.
- German UI copy, as the rest of the site.

## Decided by the owner

- Points after the games stay until the matchday ends, as on the website now.
- Substitutes: shown under the pitch on club pages with their points, instead of the flip.
- Grades: only in the articles.
- App parity for points and the points breakdown.

## Calls I made (the owner can overrule)

- Mein Team's bench stays where it is (asked, not answered; its rows already show the points).
- Re-read window 3 days, at most every 30 minutes per article, plus the one-time catch-up of stored reports.
- The substitutes' row may push the page down once on a first visit mid-match (no reserved space).
- The live dot takes the number's colour, as on the website (the first draft said red).
- The substitutes' row sits under the pitch, above the legend; exact look (faces vs. rows) is left to the
  build, with the frontend-design skill, in the calm style of the rest of the site.
- The app's club page polls on the same 30 s rhythm as the website.

## Left to the builder

- How the app shares one points-chip view between Mein Team, club pages and the substitutes' row.
- Where the scraper keeps the "last re-read" time (its state file or the article record).
- The substitutes' row layout at phone width (no horizontal page scroll; up to five substitutes per team).
