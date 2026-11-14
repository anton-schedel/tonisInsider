# Matchday Points Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On a matchday the iPhone app shows the same Kickbase points as the website (club pages, coloured chips, "Punkte am Spieltag"), every substitute's points are visible under the pitch on club pages (website and app), and match reports get their grades pitch once LigaInsider fills it in.

**Architecture:** The club points endpoint gains a `subs` list (every substitution, no new Kickbase call); the website's club page lists them under the pitch instead of flipping faces. The app ports the website's points label/tier rule into one `PointsChip` view, polls the club endpoint on club pages and loads the player endpoint for the card breakdown. The scraper re-reads stored match reports whose grades are still empty (from the stored URL, throttled), and both clients hide the bare grade headings meanwhile.

**Tech Stack:** Astro 7 on a Cloudflare Worker, TypeScript, vitest; scraper in TypeScript on GitHub Actions; SwiftUI (iOS 27, Swift 6), Swift Testing, XcodeGen.

**Spec:** `docs/superpowers/specs/2026-11-09-matchday-points-design.md`

## Global Constraints

- Website: Cloudflare Worker free plan (~10 ms CPU per request) — no new per-request parsing.
- No new Kickbase calls per viewer: the app uses the same public, edge-cached endpoints (`/api/kickbase/club/<slug>/`, `/api/kickbase/player/<id>/`).
- Points window: from kickoff until 4 days after it (the website's `MAX_AFTER_MS`); polling every 30 s only while the match runs (`live.state != 2`) and the screen is visible.
- Points tiers (from `src/lib/livePoints.ts` / `global.css`): below 0 neg `#ff453a` (ink `#d70015`); 0–99 low `#ff9f0a` (ink `#b85c00`); 100–199 mid `#9cdd49` (ink `#4f8a12`); 200–399 high `#1fc46f` (ink `#0b8a4c`); 400+ gold `#ffd23f` (ink `#a87800`); in dark mode ink = the bright colour. Pitch chip background `rgba(10,12,16,0.78)`; live dot 6 px in the number's colour, opacity pulse to 0.3 over 1.6 s, none under reduced motion.
- Label rule (`pointsLabel`): state 0 → no chip; points present → the number; running without points → "0"; over without points → "–".
- Grades re-read: only reports still waiting; from the stored URL; at most once per 30 min per article; only within 3 days of `publishedAt`, except one first try for every waiting report already stored (catch-up); at most 40 page reads per run; a read without grades changes nothing.
- German UI copy: "Eingewechselt", "63' für Guirassy", "bis 63' · Kleindienst", "Punkte", "Punkte am Spieltag", "Alle N Aktionen".
- TDD for every behaviour; repo is public (nothing account-specific committed).

## Review Focus

1. A second substitute for the same predicted slot, or one for a starter LigaInsider didn't predict → both appear in the substitutes' list (Task 1 test).
2. A club page opened before kickoff or more than 4 days after it → no polling, predictions and the alternative flip as before (Task 6 test on `ClubPointsModel.matters`).
3. Kickbase failing mid-match → chips keep their last values, the card falls back to the odds (Task 6 keeps `points` on error; Task 7 test).
4. A report re-read whose ratings parse without a single grade → stays waiting, nothing stored, no rebuild (Task 4 test).
5. A waiting report already tried once and older than 3 days → never read again; a newly stored waiting report → not re-read within 30 minutes (Task 4 tests).

---

### Task 1: Every substitution in the club points answer

**Files:**
- Modify: `src/lib/livePoints.ts` (types), `src/lib/match.ts` (new `clubSubs`), `src/pages/api/kickbase/club/[slug].ts`
- Test: `src/lib/match.test.ts`, `src/lib/livePoints.test.ts`

**Interfaces:**
- Produces: `export type ClubSub = { kb: string; name: string; photo?: string; minute: number; out: string; points?: number }` and `ClubPoints.subs?: ClubSub[]` in `livePoints.ts`; `export function clubSubs(subs: KbSub[], points: { id: string; points?: number }[]): ClubSub[]` in `match.ts` (sorted by minute); `export function subNote(sub: Pick<ClubSub, "minute" | "out">): string` in `livePoints.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
// match.test.ts
describe("clubSubs", () => {
  it("every substitution of the club, by minute, with the points of the one who came on", () => {
    const subs = [
      { teamId: "3", minute: 78, inId: "9", inName: "Beier", outName: "Guirassy" },
      { teamId: "3", minute: 63, inId: "7", inName: "Silva", outName: "Adeyemi", inPhoto: "https://kickbase.b-cdn.net/x.png" },
      { teamId: "3", minute: 85, inId: "8", inName: "Jobe", outName: "Silva" }, // a second change in the same spot
    ];
    expect(clubSubs(subs, [{ id: "7", points: 41 }, { id: "9" }])).toEqual([
      { kb: "7", name: "Silva", photo: "https://kickbase.b-cdn.net/x.png", minute: 63, out: "Adeyemi", points: 41 },
      { kb: "9", name: "Beier", minute: 78, out: "Guirassy" },
      { kb: "8", name: "Jobe", minute: 85, out: "Silva" },
    ]);
  });
});
// livePoints.test.ts
it("subNote: minute and whom he replaced", () => {
  expect(subNote({ minute: 63, out: "Guirassy" })).toBe("63' für Guirassy");
});
```

- [ ] **Step 2: Run them to see them fail** — `npx vitest run src/lib/match.test.ts src/lib/livePoints.test.ts` → FAIL (`clubSubs`/`subNote` not exported).
- [ ] **Step 3: Implement** `clubSubs` and `subNote`; in the club endpoint, when `center.live.state > 0` and `details` exist, add `subs: clubSubs(details.subs.filter((x) => x.teamId === teamId), center.players)` next to `slots` (omit when empty).
- [ ] **Step 4: Run** the two files and `npx vitest run` → all pass; `npx tsc --noEmit -p .` clean.
- [ ] **Step 5: Commit** — `feat(club points): every substitution of the club in the answer (who came on, for whom, minute, points)`.

### Task 2: Substitutes under the pitch on the website's club page, no flip

**Files:**
- Modify: `src/pages/vereine/[slug].astro` (markup under `<Pitch>`, live script)
- Test: `src/lib/livePoints.test.ts` (pure helper only); visual check

**Interfaces:**
- Consumes: `ClubPoints.subs`, `subNote` (Task 1).

- [ ] **Step 1: Write the failing test** for the card data of a substitute, a pure helper in `livePoints.ts`:

```ts
it("subCard: his card from the club page (Eingewechselt, yellow, the club's crest and match)", () => {
  expect(subCard({ kb: "7", name: "Silva", minute: 63, out: "Adeyemi" }, { crest: "/img/clubs/14.png", match: "vs Bremen · Fr. 20:30" }))
    .toEqual({ name: "Silva", crest: "/img/clubs/14.png", match: "vs Bremen · Fr. 20:30", status: "Eingewechselt (63')", tone: "yellow" });
});
```
Signature: `export function subCard(sub: ClubSub, club: { crest?: string; match?: string }): CardData` (photo included when the sub has one).
- [ ] **Step 2: Run it** → FAIL.
- [ ] **Step 3: Implement** `subCard`. Then the page:
  - After `<Pitch …/>` (so below the legend: the legend explains the pitch's dots and stays with it — a change from the spec's "above the legend"): `<div data-kb-subs hidden data-crest={lineup.club.crest} data-match={matchLine(lineup)} class="mt-3">` with a heading "Eingewechselt" (same size and weight as the legend's text, muted) and an empty `<div data-kb-subs-list class="divide-y divide-hairline">`. Hidden until there's at least one substitute (no empty heading).
  - Script: `drawSubs(data, doc)` fills the list, one `<button data-card=…>` row per sub, like `MyPlayerRow.astro`: avatar 40 px with the yellow ring, name (15 px semibold), `subNote(sub)` muted (13 px), and a `.kb-points.is-row` chip with `data-kb-points="kb<id>" data-kb-player="<id>"` on the right. Rows are rebuilt only when the list of `kb` ids changes (otherwise only the chips update, so nothing re-renders every 30 s).
  - `draw()`: the chips with `kb` keys take their points from `data.subs` (no longer from `slots`).
  - `applySlot()`: keep settling the slot (alternative or main, predictions removed); for a substitution only add the note `bis {minute}' · {name}` to the face — no cloned face, no ⇄, no `swap` wrapper.
  - Use the frontend-design skill for the row's look (calm, matches the bench rows on Mein Team, light and dark).
- [ ] **Step 4: Run** `npx vitest run` and `npx tsc --noEmit -p .` → pass. **Visual check:** `npx astro build`, put a fake answer in `sessionStorage["kbclub:borussia-dortmund"]` (two subs, `live.state: 1`) and a local lineup kickoff within the last hour (temporarily, in `store/lineups`), serve `dist/client`, screenshot `/vereine/borussia-dortmund/` at 390 px wide in light and dark. Expected: two rows under the pitch, chips coloured, no ⇄ on the replaced starters. Restore the local store afterwards.
- [ ] **Step 5: Commit** — `feat(club page): substitutes listed under the pitch with their points; a substituted starter keeps one face with "bis 63' · …" (no flip)`.

### Task 3: Recognising reports that wait for their grades; hiding the bare headings

**Files:**
- Create: `scraper/pendingGrades.ts`, `scraper/pendingGrades.test.ts`
- Modify: `src/pages/artikel/[id].astro` (body), `src/lib/appFeed.ts` (articles' body)
- Test: `src/lib/appFeed.test.ts`

**Interfaces:**
- Produces: `hasGrades(a: Pick<Article, "ratings">): boolean` (some player or sub has a grade); `pendingGrades(a: Pick<Article, "bodyHtml" | "ratings">): boolean` (no grades, and either ratings without grades or an empty grades heading); `withoutPendingHeadings(html: string): string`.

- [ ] **Step 1: Write the failing tests** (`pendingGrades.test.ts`), with the live forms:

```ts
const waiting = '<p>Tore: …</p>\n<h3>Aufstellung von Borussia Dortmund</h3><br>\n<h3></h3><br>\n<h3>Aufstellung der SV 07 Elversberg</h3><br>\n<h3></h3><br>\n';
const colons = '<p>…</p>\n<h3>Aufstellung des Hamburger SV:</h3><br>\n<h3>Aufstellung von Borussia Mönchengladbach:</h3><br>\n';
const plainText = '<p>…</p>\n<h3>Aufstellung von Bayer 04 Leverkusen</h3><p>Flekken – Quansah, Tapsoba …</p>';
it("waiting: empty grade headings (with or without colon), or ratings without a single grade", () => {
  expect(pendingGrades({ bodyHtml: waiting })).toBe(true);
  expect(pendingGrades({ bodyHtml: colons })).toBe(true);
  expect(pendingGrades({ bodyHtml: "<p>x</p>", ratings: [{ team: "BVB", lines: [[{ player: { id: 1, slug: "a", name: "A", marks: [] } }]] }] })).toBe(true);
});
it("not waiting: grades in, a lineup as plain text, or no grade heading at all", () => {
  expect(pendingGrades({ bodyHtml: waiting, ratings: [{ team: "BVB", lines: [[{ player: { id: 1, slug: "a", name: "A", grade: 2.5, marks: [] } }]] }] })).toBe(false);
  expect(pendingGrades({ bodyHtml: plainText })).toBe(false);
  expect(pendingGrades({ bodyHtml: "<p>Kobel bleibt.</p>" })).toBe(false);
});
it("withoutPendingHeadings: the empty headings (and their empty partners) go, everything else stays", () => {
  expect(withoutPendingHeadings(waiting)).toBe("<p>Tore: …</p>\n");
  expect(withoutPendingHeadings(colons)).toBe("<p>…</p>\n");
  expect(withoutPendingHeadings(plainText)).toBe(plainText);
});
```
plus in `appFeed.test.ts`: an article with the `waiting` body comes out of `appFeed()` without the headings.
- [ ] **Step 2: Run** `npx vitest run scraper/pendingGrades.test.ts src/lib/appFeed.test.ts` → FAIL.
- [ ] **Step 3: Implement** the three functions (regex over the stored body: a heading `Aufstellung (von|vom|der|des) …` optionally ending in ":", followed only by whitespace, `<br>` and empty `<h3></h3>` up to the next such heading or the end); use `withoutPendingHeadings` in `artikel/[id].astro` (`set:html`) and in `appFeed()` (map over `articles` and `pinned`).
- [ ] **Step 4: Run** `npx vitest run` and `npx tsc --noEmit -p .` → pass.
- [ ] **Step 5: Commit** — `feat(grades): recognise match reports still waiting for their grades; readers don't see the bare headings meanwhile`.

### Task 4: The scraper re-reads waiting reports

**Files:**
- Modify: `scraper/run.ts`, `scraper/types.ts` (`State.gradesTriedAt`)
- Test: `scraper/run.test.ts` (fixture `article-grades.html` has the graded form; build the waiting form by cutting its `.stadium_container_small` blocks and leaving `<h3>Aufstellung von …</h3><h3></h3>`)

**Interfaces:**
- Consumes: `pendingGrades`, `hasGrades` (Task 3).
- Produces: `State.gradesTriedAt?: Record<string, string>` (article id → ISO time of the last read for grades); constants `GRADES_WINDOW_DAYS = 3`, `GRADES_RETRY_MIN = 30`, `GRADES_READS = 40` in `run.ts`.

- [ ] **Step 1: Write the failing tests** (`run.test.ts`):
  - `"a stored report waiting for its grades is read again from its own URL, and stored once the grades are in"` — store a waiting report (not in the overview), run with its URL serving `article-grades.html` → `store.getArticle(id).ratings` has grades, `bodyHtml` without the headings, crests/photos fetched, `r.changed === true`.
  - `"a re-read without grades changes nothing, and waits 30 minutes before the next"` — URL serves the waiting form → ratings still undefined, `r.changed === false`, `state.gradesTriedAt[id]` set; a run 10 minutes later doesn't request the URL; one 31 minutes later does.
  - `"ratings without a single grade still count as waiting (not stored)"` — URL serves a page whose grade boxes are empty → nothing stored.
  - `"after 3 days only the one first try (catch-up), never again"` — a waiting report published 5 days before `now`, no `gradesTriedAt` entry → read once; a run 31 minutes later → not read.
  - `"a newly stored waiting report isn't re-read in the same half hour"` — first read of an article in the waiting form → `gradesTriedAt[id] === now`; a run 5 minutes later doesn't request it again.
  - `"at most 40 reads per run"` — 45 waiting reports → 40 requests in the first run, the other 5 in the next.
- [ ] **Step 2: Run** `npx vitest run scraper/run.test.ts` → the new tests FAIL.
- [ ] **Step 3: Implement** after step 2 (articles) in `run()`:
  - When an article is stored in the waiting form, set `state.gradesTriedAt[id] = now`.
  - A pass over `store.articles()` that are `pendingGrades`: due when never tried, or (published within 3 days and last try ≥ 30 min ago); at most 40 reads. Read `a.url`, `parseArticle(html, { id, url, headline: a.listHeadline, newsType: a.newsType }, a.category, now)`; if `hasGrades(fresh)`: store `{ ...a, ratings: fresh.ratings, bodyHtml: fresh.bodyHtml, fetchedAt }` after fetching rating crests and photos (extract the existing match-report image loop into a local helper used by both places), `result.changed = true`, drop its entry; otherwise only record the try. A failed request is logged (`console.warn`), recorded as a try, and not a problem.
  - Prune `gradesTriedAt` to articles that are still stored and still waiting.
  - Log once per run: `grades: <n> of <m> waiting reports got their grades` (only when something was read).
- [ ] **Step 4: Run** `npx vitest run` and `npx tsc --noEmit -p .` → pass.
- [ ] **Step 5: Commit** — `feat(scraper): match reports waiting for their grades are read again from their URL (every 30 min for 3 days, one first try for those already stored, at most 40 a run)`.

### Task 5: The app's points chip, like the website's

**Files:**
- Create: `ios/TonInsider/Design/PointsChip.swift`, `ios/TonInsiderTests/PointsTests.swift`
- Modify: `ios/TonInsider/Design/Pitch.swift` (`PitchFace.points`), `ios/TonInsider/MyTeam/MyTeamView.swift` (pitch face and bench row)

**Interfaces:**
- Produces: `enum PointsTier: String, Codable, Sendable { case neg, low, mid, high, gold }` with `init?(points: Int?)`, `var bright: Color`, `var ink: Color`; `struct PointsLabel: Codable, Hashable, Sendable { var text: String; var live: Bool; var tier: PointsTier? }` with `init?(state: Int, points: Int?)`; `struct PointsChip: View { let label: PointsLabel; var style: Style = .pitch /* .row */; var loading = false }`; `PitchFace.points: PointsLabel?` and `PitchFace.pointsLoading: Bool = false`.

- [ ] **Step 1: Write the failing tests** (`PointsTests.swift`), mirroring `src/lib/livePoints.test.ts`:

```swift
@Test func noChipBeforeKickoff() { #expect(PointsLabel(state: 0, points: nil) == nil) }
@Test func runningShowsPointsOrZero() {
    #expect(PointsLabel(state: 1, points: 31) == PointsLabel(text: "31", live: true, tier: .low))
    #expect(PointsLabel(state: 1, points: nil) == PointsLabel(text: "0", live: true, tier: nil))
}
@Test func overWithoutPointsIsADash() { #expect(PointsLabel(state: 2, points: nil) == PointsLabel(text: "–", live: false, tier: nil)) }
@Test func tiers() {
    #expect([-5, 0, 99, 100, 199, 200, 399, 400].map { PointsTier(points: $0) } == [.neg, .low, .low, .mid, .mid, .high, .high, .gold])
}
```
- [ ] **Step 2: Run** `xcodebuild test … -only-testing:TonInsiderTests/PointsTests` → fails to compile (types missing).
- [ ] **Step 3: Implement** the types and `PointsChip` (pitch: 11.5 pt bold monospaced digits, capsule `rgba(10,12,16,0.78)`, number in `tier.bright` else white, 6 pt dot in the same colour pulsing while `live`, static under `accessibilityReduceMotion`; row: 14 pt, `tiSurface` capsule, number in `tier.ink` else `tiForeground`; `loading`: a dimmed empty capsule 34×18 pt). `PitchFace` shows `PointsChip(label:)` instead of the plain text. Mein Team: `MyPitchFace` passes `PointsLabel(state: live.state, points: live.points)`; `MyPlayerRow` uses `PointsChip(style: .row)`.
- [ ] **Step 4: Run** the whole app suite → pass.
- [ ] **Step 5: Commit** — `feat(app): points chips in Kickbase's colours with the live dot, like the website (Mein Team)`.

### Task 6: Live points and substitutes on the app's club pages

**Files:**
- Create: `ios/TonInsider/Lineups/ClubPoints.swift` (model + `ClubPointsModel`), `ios/TonInsiderTests/ClubPointsTests.swift`, `ios/TonInsiderTests/Fixtures/club-points.json`
- Modify: `ios/TonInsider/Lineups/ClubView.swift` (`LineupPitch`, substitutes list)

**Interfaces:**
- Consumes: `PointsLabel`, `PointsChip`, `PitchFace.points` (Task 5); the endpoint's `subs` (Task 1).
- Produces: `struct ClubPoints: Codable, Sendable { var live: Live; var players: [String: Int]; var ids: [String: String]?; var slots: [String: SlotPlay]?; var subs: [ClubSub]? }` (`Live { state: Int; minute: Int?; kickoff: Date? }`, `SlotPlay { show: String; sub: SlotSub? }`, `SlotSub { kb: String; name: String; photo: String?; minute: Int; points: Int? }`, `ClubSub { kb: String; name: String; photo: String?; minute: Int; out: String; points: Int? }`); `@Observable @MainActor final class ClubPointsModel { private(set) var points: ClubPoints?; static func matters(kickoff: Date?, now: Date) -> Bool; func run(slug: String, kickoff: Date?) async }`; `static func played(_ p: LineupPlayer, _ play: SlotPlay?) -> (shown: PlayerRef, note: String?)` on `LineupPitch`.

- [ ] **Step 1: Write the failing tests** (`ClubPointsTests.swift`):
  - decodes `club-points.json` (a recorded answer with `slots` and two `subs`).
  - `matters`: `nil` kickoff → false; 1 min before → false; at kickoff → true; 3 days 23 h after → true; 4 days after → false.
  - `played`: `show == "alt"` with an alternative → the alternative, no note; a slot with `sub` minute 63 name "Beier" → main player, note `"bis 63' · Beier"`; no play → main, no note.
  - `run`: with a stub `API` answering `live.state: 2` → `points` set and the loop returns after one request; on a request error `points` keeps the last answer.
- [ ] **Step 2: Run** `-only-testing:TonInsiderTests/ClubPointsTests` → fails to compile.
- [ ] **Step 3: Implement**:
  - `ClubPointsModel.run`: returns at once when `!matters`; shows the last answer for this slug from a static in-memory cache, then `GET api/kickbase/club/<slug>/` every 30 s until `live.state == 2`; keeps `points` on errors.
  - `ClubView`: `@State private var live = ClubPointsModel()`, `.task(id: scenePhase == .active) { if scenePhase == .active { await live.run(slug:kickoff:) } }`.
  - `LineupPitch` gets `points: ClubPoints?` and `inWindow: Bool`. In the window: each slot uses `played()`, no "Alt:"/"statt" notes, no ⇄, the chip from `players[String(shown.id)]` via `PointsLabel(state:points:)` (placeholder chip while `points == nil`). Outside: exactly as today.
  - Under the pitch, when `subs` isn't empty: "Eingewechselt" (13 pt muted) and one row per sub like Mein Team's bench row: avatar 40 with the yellow ring, name, "63' für Guirassy" muted, `PointsChip(style: .row)`. Tapping opens his card (`PlayerCardData` with status "Eingewechselt (63')", tone yellow, the club's crest and match line, `kickbaseId`, `points`).
  - Tapping a pitch face in the window passes `kickbaseId: points.ids?[String(shown.id)]` and `points:` to the card (Task 7 uses them).
- [ ] **Step 4: Run** the whole app suite → pass. Simulator check: launch with `-TISiteURL` pointing at a local build serving a fake club answer, or during a live match against production; screenshot one club page.
- [ ] **Step 5: Commit** — `feat(app): club pages show live points from kickoff and the substitutes under the pitch`.

### Task 7: "Punkte am Spieltag" in the app's player card

**Files:**
- Create: `ios/TonInsider/Player/PlayerPoints.swift` (model + loader), `ios/TonInsiderTests/PlayerPointsTests.swift`
- Modify: `ios/TonInsider/Player/PlayerCard.swift`, `ios/TonInsider/MyTeam/MyTeamView.swift` (cards opened from Mein Team carry the Kickbase id and label)

**Interfaces:**
- Consumes: `PointsLabel`, `PointsTier` (Task 5); `kickbaseId`/`points` passed from club pages (Task 6).
- Produces: `PlayerCardData.kickbaseId: String?`, `PlayerCardData.points: PointsLabel?`; `struct PlayerPoints: Decodable, Sendable { var live: AppTeam.Live; var lines: [Line] }` (`Line { name: String; count: Int; points: Int }`); `@MainActor final class PointsBreakdown { static let shared; func load(_ id: String, now: Date = .now) async throws -> PlayerPoints }` (cached: fresh 30 s while running, 600 s once over); `static func visible(_ lines: [PlayerPoints.Line], all: Bool) -> (shown: [PlayerPoints.Line], hidden: Int)` on `PointsBreakdown`; `PlayerCardView.shownLines = 6`.

- [ ] **Step 1: Write the failing tests** (`PlayerPointsTests.swift`): decoding a recorded `/api/kickbase/player/<id>/` answer; `load` asks once and serves the cache within 30 s while running (and within 10 min once over), asks again after; `PointsBreakdown.visible(lines, all: false)` gives the first 6 and `hidden == lines.count - 6` (so the card can say "Alle N Aktionen"); a failing load throws (the card then shows the odds).
- [ ] **Step 2: Run** `-only-testing:TonInsiderTests/PlayerPointsTests` → fails to compile.
- [ ] **Step 3: Implement**:
  - `PlayerCardView`: when `data.points` is set, the big number is `data.points.text` in `tier.ink` with the caption "Punkte" (and the live dot while `live`); when `data.kickbaseId` is set, "Punkte am Spieltag" replaces the odds row: six placeholder lines while loading, then the lines (name, "2×" muted when count > 1, "+12"/"-3" in `actionTier` colour: negative neg, ≥ 20 high, else mid), "Alle N Aktionen" for the rest; on failure or an answer with `state == 0` or no lines, the odds row as before.
  - Mein Team: opening a card from the pitch or the bench passes `kickbaseId: p.id` and `points: PointsLabel(state:points:)` when `live.state > 0`.
- [ ] **Step 4: Run** the whole app suite → pass.
- [ ] **Step 5: Commit** — `feat(app): "Punkte am Spieltag" in the player card from kickoff on, his points as the big number`.

### Task 8: Ship and check

- [ ] **Step 1:** `npx vitest run` and `npx tsc --noEmit -p .` (website, scraper) and the whole app suite → all pass; record the numbers.
- [ ] **Step 2:** Final whole-branch review (fresh reviewer, most capable model) per the execution skill; fix Critical/Important with RED→GREEN tests.
- [ ] **Step 3:** Push to main (deploys); wait for the deploy run to succeed.
- [ ] **Step 4:** After the first scraper runs with Task 4: count articles with grades in the live snapshot (`/data/snapshot.json`) against the 36 waiting before; report to the owner whether the catch-up brought grades (spec: if none, the cause is a different one — say so before changing anything else).
- [ ] **Step 5:** Release build installed on the owner's iPhone (`xcodebuild … -configuration Release -destination 'platform=iOS,id=<UDID>'`, `xcrun devicectl device install app …`; `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer`).
