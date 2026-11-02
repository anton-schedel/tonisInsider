# Team Summary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A few written sentences at the top of Mein Team about the manager's squad: matchups that stand out (point profile vs. this week's opponent, home/away, momentum), rotation risk around European/cup games, and how far LigaInsider's prediction can be trusted per club.

**Architecture:** Pure functions in `src/lib/summary/` compute each part from data the scraper already collects (`public/data/kb-history.json`, `snapshot.state.predictions`, `snapshot.state.cupGames`, `snapshot.state.odds`, `snapshot.lineups`); one composer turns them into German sentences; Mein Team renders them in a calm text block above "Aufstellung". Kickbase ids join the user's squad to the history directly; LigaInsider ↔ Kickbase only for reliability (via `mapClubs` / `nameMatches`).

**Tech Stack:** TypeScript, Astro 7 (server-rendered `src/pages/mein-team.astro` on a Cloudflare Worker), Vitest.

**Spec:** `docs/superpowers/specs/2026-11-02-team-summary-design.md`

## Global Constraints

- Only this season's data (`KbHistory.season`); no LLM — sentences come from templates in our code.
- Recency weight: each game counts 15 % less than the next newer one: `RECENCY = 0.85`, weight of the k-th newest game (k = 0 newest) is `0.85 ** k`. Momentum = plain points of the last 5 matches (3 win, 1 draw).
- Minimum samples: reliability ≥ 3 saved matchdays per club; rotation ≥ 2 of the player's matchdays next to a cup/European game; point profile ≥ 4 games with minutes.
- Point shares divide by the sum of a game's stored event points, never by `HistGame.points`.
- A player's club in a past game is `HistGame.team`, not `HistPlayer.team`.
- At most 3 players named in the matchup sentence; at most 3 sentences after the opening one.
- Visible only before the first kickoff of the matchday the current lineups belong to; hidden from then on (Kickbase locks the lineup).
- Look: calm text in the app's typography, no cards, no colour tints, no tables (memory: design taste).
- No new requests during the page load except reading the static `/data/kb-history.json` (cached per isolate and build like `loadSnapshot`).

**Ruling (plan vs. spec):** the spec says "the summary loads after the page (its own request, cached)". Its purpose is "Mein Team must not get slower". All inputs are static files already loaded or cached per isolate, and the computation is in-memory, so the plan renders the summary inline in the server render instead of a second request. Cost if wrong: one extra request route later.

**Ruling (spec part 1):** the spec also mentions "how often a doubtful spot went to the predicted player or his alternative". No sentence uses it, so it isn't built now (YAGNI); `reliabilityByClub` can add it later from the same data. Cost if wrong: one more field in Task 6.

## Review Focus

1. A squad player with no history (new signing, no games yet) → he is simply not mentioned; nothing throws. (Task 4, 5 tests)
2. `kb-history.json` missing (fresh deploy before the first backfill) → Mein Team renders as today, no summary, no error. (Task 2, 7 tests)
3. A club whose Kickbase name doesn't map to a LigaInsider lineup (`mapClubs` miss) → that club is left out of reliability; other clubs still work. (Task 6 test)
4. Lineups still showing a finished matchday (LigaInsider hasn't switched yet) → no summary rather than one about past opponents. (Task 7 test)
5. A player who moved clubs mid-season → his home/away and opponents use the club of each game (`HistGame.team`). (Task 4 test)

---

## File Structure

| File | Responsibility |
|---|---|
| `scripts/event-groups.mjs` (create) | One-off: fetches Kickbase's event types and writes `src/lib/summary/eventGroups.json` by keyword rules |
| `src/lib/summary/eventGroups.json` (create, generated, committed) | `{ "<eti>": "<group>" }` |
| `src/lib/summary/groups.ts` (create) | `Group` type, `groupOf(eti)` |
| `src/lib/kbHistoryServer.ts` (create) | `loadKbHistory(url)`: reads `/data/kb-history.json` from the assets, cached per isolate and build |
| `src/lib/summary/teamForm.ts` (create) | Team strength before a date from match results: weighted ppg overall/home/away, momentum |
| `src/lib/summary/profile.ts` (create) | A player's weighted point profile and his matchup index for an upcoming game |
| `src/lib/summary/rotation.ts` (create) | Rotation risk around cup/European games |
| `src/lib/summary/reliability.ts` (create) | Prediction reliability per club from saved predictions vs. Kickbase starts |
| `src/lib/summary/compose.ts` (create) | Visibility window, picking what to say, German sentences |
| `src/components/TeamSummary.astro` (create) | Renders the sentences |
| `src/pages/mein-team.astro` (modify) | Loads the history, builds the input, renders `<TeamSummary>` above "Aufstellung" |

---

### Task 1: Event groups

**Files:**
- Create: `scripts/event-groups.mjs`, `src/lib/summary/eventGroups.json`, `src/lib/summary/groups.ts`
- Test: `src/lib/summary/groups.test.ts`

**Interfaces:**
- Produces: `type Group = "attack" | "pass" | "duel" | "defence" | "keeper" | "time" | "mistake" | "team" | "other"`; `groupOf(eti: number | string): Group` (unknown id → `"other"`); `GROUP_LABEL: Record<Group, string>` (German, used in sentences: attack "Offensivaktionen", pass "Pässen", duel "Zweikämpfen", defence "Defensivaktionen", keeper "Torwartaktionen", time "Einsatzzeit", mistake "Fehlern", team "Mannschaftserfolg", other "Sonstigem").

- [ ] **Step 1: Write the script** `scripts/event-groups.mjs`: logs in with `KICKBASE_EMAIL`/`KICKBASE_PASSWORD` from the environment (same request as `scripts/record-kickbase-fixtures.mjs`), GETs `/v4/live/eventtypes` with `accept-language: de-DE`, keeps ids > 0, assigns the first matching rule in this order, writes sorted JSON:
  - keeper `/\(TW\)|Parade|gehalten|Torwart|Abwurf|Abschlag|Rauslaufen/`
  - mistake `/Karte|Foul|Ballverlust|vergeben|Eigentor|Fehler|verloren|Abseits|verursacht|verschossen|verschuldet|kassiert|Platzverweis|Handspiel|Ausgespielt|zu weit/`
  - team `/Spiel gewonnen|Teamtor|Unentschieden/`
  - attack `/Tor|Schuss|schuss|Assist|Torvorlage|Pass des Todes|Großchance|Elfmeter|Penalty|Dribbling|ausgedribbelt|Aluminium|Latte|Pfosten|Eins-gegen-Eins/`
  - duel `/Zweikampf|Duell/`
  - defence `/Tackling|Abgefangen|abgefangen|Klärung|geklärt|Geklärt|Block|geblockt|Zu Null|Ballgewinn|Balleroberung|gestört/`
  - pass `/Pass|Flanke|Ecke|Freistoß|Vorlage/`
  - time `/Minuten|Startelf|Einwechsl|eingewechselt/`
  - else other
- [ ] **Step 2: Run it** — `set -a; . ./.env; set +a; node scripts/event-groups.mjs` — Expected: `src/lib/summary/eventGroups.json` with ~620 entries; print the count per group; "other" should be under 15 % (adjust the rules if not, and note it).
- [ ] **Step 3: Write the failing test** `groups.test.ts`:
```ts
expect(groupOf(4216)).toBe("attack");   // Torschuss (aufs Tor)
expect(groupOf(4231)).toBe("duel");     // Gewonnener Zweikampf
expect(groupOf(4240)).toBe("mistake");  // Ballverlust
expect(groupOf(4237)).toBe("time");     // Startelf
expect(groupOf("4201")).toBe("pass");   // Pass vorderes Drittel
expect(groupOf(999999)).toBe("other");
```
- [ ] **Step 4:** `npx vitest run src/lib/summary/groups.test.ts` → FAIL (module missing).
- [ ] **Step 5: Implement** `groups.ts` reading the JSON with a static import.
- [ ] **Step 6:** run again → PASS.
- [ ] **Step 7: Commit** `feat(summary): Kickbase event types grouped into attack, duels, …`

### Task 2: History loader

**Files:**
- Create: `src/lib/kbHistoryServer.ts`
- Test: `src/lib/kbHistoryServer.test.ts`

**Interfaces:**
- Consumes: `KbHistory` from `scraper/kbHistory.ts`; `BUILD_ID` from `src/lib/build.ts`; the pattern of `src/lib/snapshotServer.ts`.
- Produces: `loadKbHistory(url: URL): Promise<KbHistory | undefined>` — `env.ASSETS.fetch("/data/kb-history.json")`; undefined on non-OK, invalid JSON, or `version` ≠ `HISTORY_VERSION`; cached in `globalThis.__kbHistory` per `BUILD_ID`.

- [ ] **Step 1: Failing tests** (mock `cloudflare:workers` like the existing tests that mock `env`; see `src/lib/*.test.ts` using `vi.mock("cloudflare:workers")`): returns the parsed history for a 200 with `version: 3`; `undefined` for 404; `undefined` for `version: 2`; a second call doesn't fetch again.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** run → PASS.
- [ ] **Step 5: Commit** `feat(summary): read the Kickbase history from the site's assets`

### Task 3: Team form

**Files:**
- Create: `src/lib/summary/teamForm.ts`
- Test: `src/lib/summary/teamForm.test.ts`

**Interfaces:**
- Consumes: `HistMatch` (`scraper/kbHistory.ts`).
- Produces:
  - `RECENCY = 0.85`
  - `type Form = { games: number; ppg: number; homePpg?: number; awayPpg?: number; momentum: number; last: number }` — `ppg` weighted by recency; `homePpg`/`awayPpg` weighted over home/away games only (undefined without such games); `momentum` = points from the last 5; `last` = number of games momentum counts (≤ 5).
  - `formBefore(matches: Record<string, HistMatch>, teamId: string, before: string): Form | undefined` — only finished matches (both goals present) with `date < before`; undefined with 0 games.
  - `venuePpg(f: Form, home: boolean): number` — the venue's ppg, falling back to `ppg`.

- [ ] **Step 1: Failing tests** with a hand-made `matches` record for team "2": results W (home, oldest), L (away), D (home), W (away, newest):
  - `formBefore(m, "2", "2099-01-01")` → `games: 4`, `momentum: 7`, `last: 4`.
  - weighted `ppg`: weights newest→oldest 1, 0.85, 0.7225, 0.614125 on points 3,1,0,3 → `(3*1 + 1*0.85 + 0*0.7225 + 3*0.614125) / (1+0.85+0.7225+0.614125)` ≈ `1.786` (`toBeCloseTo(1.786, 3)`).
  - `homePpg` uses only the two home games (D newer weight 1, W older 0.85) → `(1*1 + 3*0.85)/1.85` ≈ `1.919`.
  - `before` = the date of the 3rd game → only the first two count (`games: 2`).
  - unknown team → `undefined`.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** run → PASS.
- [ ] **Step 5: Commit** `feat(summary): team strength, home/away and momentum as they were before a match`

### Task 4: Point profile and matchup index

**Files:**
- Create: `src/lib/summary/profile.ts`
- Test: `src/lib/summary/profile.test.ts`

**Interfaces:**
- Consumes: `HistPlayer`, `HistMatch` (`scraper/kbHistory.ts`); `groupOf`, `Group` (Task 1); `formBefore`, `venuePpg`, `RECENCY` (Task 3).
- Produces:
  - `MIN_GAMES = 4`; `STRONG_PPG = 1.7`; `WEAK_PPG = 1.0` (opponent's venue ppg at the time).
  - `type Context = { home: boolean; opponent: "strong" | "middle" | "weak" }`
  - `contextOf(form: Form | undefined, opponentHome: boolean): Context["opponent"]` — by `venuePpg(form, opponentHome)`; undefined form → `"middle"`.
  - `type Profile = { games: number; avg: number; shares: Partial<Record<Group, number>>; top: Group; byContext: { avg: number; games: number; context: Context }[] }` — `avg` weighted by recency over games with minutes; `shares` = weighted sums per group of positive event points ÷ weighted sum of all positive event points (negatives left out, so shares sum to 1); `top` = largest share excluding `time` and `team`; `byContext` = weighted avg per (home, opponent) bucket.
  - `profileOf(p: HistPlayer, matches: Record<string, HistMatch>): Profile | undefined` — undefined with fewer than `MIN_GAMES` games with minutes. Home/away and opponent per game from `HistGame.team` and the match's `home`/`away`; opponent context from `formBefore(matches, opponentId, match.date)`.
  - `matchupIndex(profile: Profile, upcoming: Context): { index: number; games: number } | undefined` — the bucket's avg ÷ `profile.avg`; undefined if the bucket has fewer than 2 games.

- [ ] **Step 1: Failing tests:**
  - 3 games with minutes → `profileOf` is `undefined`.
  - a player with 4 attacking games (events `{4216: 12, 4231: 5}`) → `top: "attack"`, `shares.attack` ≈ 12/17.
  - negative events (`4240: -1`) don't lower shares; shares sum to 1 (`toBeCloseTo(1)`).
  - transfer: games 1–2 with `team: "7"`, games 3–4 with `team: "10"` and `player.team = "10"` → home/away of games 1–2 are computed from team "7" (assert via `byContext` buckets: a game where "7" was home counts as `home: true`).
  - `matchupIndex` → `undefined` for a bucket with 1 game; for buckets {home strong: avg 50, 2 games} and overall avg 100 → `index: 0.5`.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** run → PASS.
- [ ] **Step 5: Commit** `feat(summary): a player's point profile and how he does in this week's kind of match`

### Task 5: Rotation risk

**Files:**
- Create: `src/lib/summary/rotation.ts`
- Test: `src/lib/summary/rotation.test.ts`

**Interfaces:**
- Consumes: `HistPlayer`, `HistMatch`; `CupGame` (`scraper/cupGames.ts`); `sameClub` (`src/lib/odds.ts`).
- Produces:
  - `NEAR_DAYS = 3`; `MIN_NEAR = 2`; `DROP = 0.25` (start rate next to cup games at least 25 points lower than otherwise).
  - `cupGameNear(games: CupGame[], clubName: string, date: string): CupGame | undefined` — a game of that club (Kickbase club name matched with `sameClub` against `home`/`away`) within `NEAR_DAYS` days of `date`.
  - `type Rotation = { near: CupGame; nearStarts: number; nearGames: number; usualRate: number }`
  - `rotationRisk(p: HistPlayer, clubName: string, matches: Record<string, HistMatch>, cupGames: CupGame[], kickoff: string): Rotation | undefined` — undefined unless (a) a cup game is near `kickoff`, (b) the player has ≥ `MIN_NEAR` past Bundesliga games with a cup game near them, (c) his start rate in those is ≥ `DROP` below his start rate in the others.

- [ ] **Step 1: Failing tests:** no cup game near the upcoming kickoff → undefined; 1 past near game → undefined; started 4 of 4 usual and 0 of 2 near → `{ nearStarts: 0, nearGames: 2, usualRate: 1 }` with `near` = the upcoming cup game; started 2 of 2 near and 3 of 4 usual → undefined; `"Bayern Munich"` (cup list) matches Kickbase's `"Bayern"`.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** run → PASS.
- [ ] **Step 5: Commit** `feat(summary): rotation risk around European and cup games`

### Task 6: Prediction reliability

**Files:**
- Create: `src/lib/summary/reliability.ts`
- Test: `src/lib/summary/reliability.test.ts`

**Interfaces:**
- Consumes: `SavedPrediction` (`scraper/predictions.ts`); `KbHistory`; `nameMatches` (`src/lib/match.ts`, takes `(kickbaseName, {id, slug, name})`).
- Produces:
  - `MIN_MATCHDAYS = 3`
  - `type Reliability = { matchdays: number; hits: number /* avg of 11 */ }`
  - `reliabilityByClub(predictions: SavedPrediction[], history: KbHistory, kbTeamOf: (ligainsiderSlug: string) => string | undefined): Map<string /* LigaInsider slug */, Reliability>` — per saved matchday and club: the Kickbase match of that club (`HistMatch` with `home`/`away` = team id, `date` within 1 day of the club's `kickoff`); actual starters = history players with a game in that match, `team` = the club and `start: true`; hits = predicted XI players whose name `nameMatches` a starter's name. A club-matchday whose Kickbase match isn't in the history yet is skipped. Only clubs with ≥ `MIN_MATCHDAYS` counted matchdays. `kbTeamOf` is built in Task 8 from `mapClubs`.

- [ ] **Step 1: Failing tests:** 3 saved matchdays where 9, 10, 8 predicted starters started → `hits: 9`, `matchdays: 3`; 2 matchdays → club absent; `kbTeamOf` returns undefined for a club → that club absent, others present; a matchday whose match isn't in `history.matches` → not counted.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** run → PASS.
- [ ] **Step 5: Commit** `feat(summary): how often LigaInsider's prediction was right, per club`

### Task 7: Composer

**Files:**
- Create: `src/lib/summary/compose.ts`
- Test: `src/lib/summary/compose.test.ts`

**Interfaces:**
- Consumes: Tasks 3–6; `Chances` (`src/lib/odds.ts`).
- Produces:
  - `type SummaryPlayer = { name: string; inPredictedXi: boolean; clubSlug?: string; clubName?: string /* LigaInsider's club name, for the sentences */; profile?: Profile; matchup?: { index: number; games: number; context: Context; opponentName: string; opponentForm?: Form; day: string /* "Samstag" */ }; rotation?: Rotation }`
  - `type SummaryInput = { now: Date; firstKickoff?: string; players: SummaryPlayer[]; reliability: Map<string, Reliability> }`
  - `summaryVisible(now: Date, firstKickoff: string | undefined): boolean` — true only if `firstKickoff` is known and `now < firstKickoff`.
  - `composeSummary(input: SummaryInput): string[]` — `[]` when not visible. Otherwise:
    1. Opening: `Von deinen {n} Spielern stehen {k} in der voraussichtlichen Startelf.` Add `{u} davon bei Vereinen, deren Prognose oft danebenliegt.` when u > 0, where "oft daneben" = reliability `hits < 9`.
    2. Matchups: players with `matchup` and `|index − 1| ≥ 0.3`, sorted by `|index − 1|` desc, at most 3, one sentence: `{Name} holt {auswärts|zu Hause} gegen {formstarke|formschwache|durchschnittliche} Teams {nur halb so viele|doppelt so viele|deutlich weniger|deutlich mehr} Punkte wie sonst, die meisten aus {GROUP_LABEL[top]}` joined with `; ` and ending with the first player's game: `– am {day} gegen {opponentName} ({momentum} Punkte aus den letzten {last} Spielen).` (index ≤ 0.6 → "nur halb so viele", ≥ 1.8 → "doppelt so viele", < 1 → "deutlich weniger", else "deutlich mehr").
    3. Rotation: players with `rotation`, at most 3: `Rotationsgefahr: {names} – {Verein} spielt {Wochentag} in der {competition}, und nach solchen Spielen stand {er|sie alle} zuletzt seltener in der Startelf.` (single player: `…stand {Name} nur {nearStarts} von {nearGames} Mal in der Startelf.`)
    4. Reliability: clubs of the user's players with `hits < 9`, at most 2: `Bei {Verein} lag LigaInsider zuletzt nur bei {hits} von 11 richtig.` (hits rounded to whole numbers).
  - Exact wording may be polished in review with the owner; the structure and thresholds are fixed here.

- [ ] **Step 1: Failing tests:**
  - `summaryVisible(new Date("2026-11-06T18:59Z"), "2026-11-06T19:30Z")` → true; at `19:30Z` → false; `undefined` kickoff → false (covers Review Focus 4: lineups of a finished matchday have a past first kickoff).
  - no players with profile/rotation/reliability → exactly the opening sentence.
  - 5 matchup candidates → only the 3 with the largest |index − 1| are named; index 0.95 is never named.
  - reliability `hits: 7.4` for the club of one of the user's players → contains `nur bei 7 von 11`.
  - not visible → `[]`.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** run → PASS.
- [ ] **Step 5: Commit** `feat(summary): the summary's sentences`

### Task 8: Mein Team

**Files:**
- Create: `src/components/TeamSummary.astro`
- Modify: `src/pages/mein-team.astro` (load in the `Promise.all` next to `snapshotLoad`; build `SummaryInput`; render above the "Aufstellung" `<section>`)
- Test: `src/lib/summary/input.test.ts` for the input builder

**Interfaces:**
- Consumes: everything above; `MyPlayer` (`src/lib/match.ts`: `kickbase.id`, `kickbase.teamId`, `lineup`, `status`); `mapClubs(table, lineups)` → `Map<kbTeamId, Lineup>`; `toFixtures`, `chancesFor`; `snapshot.state.predictions`, `snapshot.state.cupGames`; Kickbase table names (`g.__kbTable.teams`).
- Produces: `summaryInput(args: { now: Date; players: MyPlayer[]; history: KbHistory | undefined; lineups: Lineup[]; predictions: SavedPrediction[]; cupGames: CupGame[]; table: KbTeam[] }): SummaryInput` in `src/lib/summary/input.ts` — `firstKickoff` = earliest kickoff among `lineups` of the most common `matchday`; `inPredictedXi` = `status` in `confirmed | start | contested | doubtful`; profile/matchup/rotation from `history.players[kickbase.id]` (absent → just name + XI flag); the upcoming context from the player's fixture (`lineup` → fixture → home/away and opponent Kickbase id via `mapClubs` inverse); `kbTeamOf` for reliability from `mapClubs`.
- `TeamSummary.astro`: `<p>` per sentence, `text-[15px] leading-snug`, first sentence normal weight, the rest `text-muted`; no heading, no border, no background. Nothing rendered for `[]`.

- [ ] **Step 1: Failing tests** for `summaryInput`: `history: undefined` → players have only `name`/`inPredictedXi` (Review Focus 2); a squad player without `history.players` entry → no profile, no throw (Review Focus 1); `firstKickoff` is the earliest kickoff of the majority matchday.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement `input.ts`, the component and the page change. **Step 4:** `npx vitest run` → all PASS; `npm run typecheck` → clean.
- [ ] **Step 5: Verify in the real page.** Use the `run` skill (or `npm run dev` with `npm run snapshot` first so `public/data/kb-history.json` exists from the local `store/`); sign in on `/mein-team/` with the account from `.env`; screenshot at 375 px wide in light and dark mode. Expected: 1–4 calm sentences above "Aufstellung", no layout shift elsewhere. Show the screenshot to the owner before pushing.
- [ ] **Step 6: Commit** `feat(mein-team): the team summary above the lineup`
