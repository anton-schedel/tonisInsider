# Upvotes and Polls under Own Posts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Comments under our own posts get LigaInsider-style upvotes and polls; bots add uneven upvotes, their own polls and poll votes, and visitors' content gets bot votes too, all growing over 30 minutes.

**Architecture:** Pure logic in `src/lib/ownVotes.ts` (growth curve, bot vote numbers, poll view, poll validation). D1 migration 0005 adds votes, polls and bot counts; the own-comments API returns score, the viewer's vote and polls, and takes upvotes and poll votes. `OwnComments.astro` gets `Comments.astro`'s vote button, poll rendering and Kommentar/Umfrage switch. The bot pipeline (`coachBots.ts`, `coachBotJob.ts`) asks for upvotes and polls and stores them.

**Tech Stack:** Astro 7, Cloudflare Worker + D1, Tailwind 4, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-24-own-comment-votes-polls-design.md`

## Global Constraints

- Only upvotes, toggled by a second tap; no login. Visitor id: random id in cookie `ov` (HttpOnly, Secure, SameSite=Lax, 400 days), set by the Worker on the first vote.
- Polls: question 3–200 chars, 2 to 6 answers of 1–80 chars; one vote per visitor per poll, final (like LigaInsider).
- Bot votes visible = full number × growth(t), t = time since the comment's `created_at`, growth 0 → 1 over 30 minutes; computed by the Worker on each request, full numbers never sent.
- Bot posts get 1 or 2 polls in total; `?more=` adds a poll only while the post has fewer than 2.
- Visitors' comments and polls get bot votes at creation (random, uneven, no model call).
- Bot rules (no looks/weight/origin/…, body-insult filter, no teammates' names as bot names) apply to poll questions and answers.
- Look: the classes and markup of `Comments.astro` (`vote-btn`, `vote-chevron`, `vote-count`, `poll`, `poll-choice`, `poll-fill`, `is-best`, `is-mine`, `poll-check`, `poll-total`).
- Existing posts unchanged; only post 900001003 (Loibl) gets upvotes and polls on prod as the live test.

## Review Focus

1. A planned (future-dated) bot comment with a poll: neither comment nor poll nor votes visible before its time.
2. A visitor upvotes, reloads: still marked as theirs, count includes it once (cookie identity).
3. Deleting a comment (coach) or a post: its poll, options and votes go too, no orphans breaking the list.
4. Poll percentages with bot + real votes: sum to ~100, a 0-vote poll shows 0% everywhere, no division by zero.
5. Two quick taps on ▲ or on a poll answer: counted once.

---

### Task 1: Pure vote logic (`src/lib/ownVotes.ts`)

**Files:** Create `src/lib/ownVotes.ts`, `src/lib/ownVotes.test.ts`

**Interfaces — Produces:**
```ts
export const GROW_MS = 30 * 60_000;
export function grown(full: number, createdAt: string, now: Date): number;          // integer, ease-out, 0 at t<=0, full at t>=GROW_MS
export function botUpvotes(random?: () => number): number;                          // 0..40, uneven: ~15% 0, most 1–8, ~10% 15+
export function botPollVotes(options: number, random?: () => number): number[];    // total 6–30 spread unevenly over options
export type PollOptionView = { id: number; label: string; pct: number };
export type PollView = { question: string; total: number; options: PollOptionView[]; mine?: number };
export function pollView(question: string, options: { id: number; label: string; bot: number; real: number }[], createdAt: string, now: Date, mine?: number): PollView;
export type NewPoll = { question: string; options: string[] };
export function parseNewPoll(raw: unknown): NewPoll | { error: string };
```

- [ ] Tests: `grown(20, t0, t0)=0`, `grown(20, t0, t0+30min)=20`, `grown(20, t0, t0+15min)` between 10 and 20 (ease-out), monotonic; `botUpvotes(()=>0)=0`, `botUpvotes(()=>0.999)>=15`; `botPollVotes(2,()=>0.5)` length 2, sum 6–30; `pollView` pct sums to 100 (±1) with votes, all 0 with none, `mine` passed through, total = grown bot + real; `parseNewPoll` errors "Schreib eine Frage." (question < 3), "Mindestens zwei Antworten." (< 2 non-empty), trims and caps 6 options.
- [ ] Run `npx vitest run src/lib/ownVotes.test.ts` → FAIL; implement; → PASS. Commit.

### Task 2: Storage and API

**Files:** Create `migrations/0005_own_votes_polls.sql`, `src/pages/api/own-comments/[id]/vote.ts`, `src/pages/api/own-comments/[id]/poll-vote.ts`; modify `src/lib/ownComments.ts` (types + `toThreads`), `src/pages/api/own-comments/[id].ts` (GET joins, POST accepts `poll`), `src/pages/api/coach/comments/[id].ts` and `src/lib/coachDb.ts` `deletePost` (delete polls/votes too), `src/lib/ownComments.test.ts`.

**Schema (0005):** `ALTER TABLE comments ADD COLUMN bot_upvotes INTEGER NOT NULL DEFAULT 0`; `comment_votes(comment_id, voter, PRIMARY KEY(comment_id, voter))`; `polls(comment_id INTEGER PRIMARY KEY, question TEXT NOT NULL)`; `poll_options(id INTEGER PRIMARY KEY AUTOINCREMENT, comment_id INTEGER NOT NULL, label TEXT NOT NULL, bot_votes INTEGER NOT NULL DEFAULT 0, position INTEGER NOT NULL)`; `poll_votes(comment_id, voter, option_id, PRIMARY KEY(comment_id, voter))`.

**Interfaces — Produces:**
```ts
// ownComments.ts
export type OwnComment = { id: number; user: string; date: string; text: string; replies: OwnComment[]; score: number; voted: boolean; poll?: PollView };
export type Row = { id; parent_id; name; body; created_at; bot_upvotes: number; real_upvotes: number; voted: 0 | 1 };
export function toThreads(rows: Row[], polls: Map<number, PollView>, now: Date): OwnComment[];   // score = grown(bot_upvotes) + real_upvotes
export const VOTER_COOKIE = "ov";
```
- `POST /api/own-comments/<post>/vote` `{ comment, on: boolean }` → `{ score, voted }`; `POST …/poll-vote` `{ comment, option }` → `{ poll }` (409 "Schon abgestimmt." on a second vote). Both: same-origin check, comment must belong to the post and be out, set `ov` cookie if missing, rate limit 60 per sender per 10 min.
- `POST /api/own-comments/<post>/` takes `{ name, poll: { question, options } }` (text optional then); stores the poll with `botPollVotes` per option and the comment with `botUpvotes()`.

- [ ] Tests (ownComments.test.ts): `toThreads` maps score/voted, attaches a poll by comment id, keeps existing nesting test green.
- [ ] Implement; `npm run typecheck`; apply 0005 to the local test DB; check GET/POST/vote/poll-vote with curl against `wrangler dev`. Commit.

### Task 3: Comment UI like LigaInsider (`src/components/OwnComments.astro`)

- [ ] Copy from `Comments.astro`: `voteControl` (always a button here, no login), `renderPoll` (vote buttons until voted, then bars), the Kommentar/Umfrage `.seg` with question, options and "Weitere Antwort" (hidden at 6), the height animation of the fields.
- [ ] Upvote: optimistic toggle (count ±1, `is-on`), POST, roll back on error; a second tap while pending ignored. Poll vote: optimistic bars with the choice marked, replaced by the server's `poll`.
- [ ] Screenshots at 390 px light/dark against `wrangler dev` with a seeded post (comments, a poll, votes). Commit.

### Task 4: Bots write upvotes and polls

**Files:** modify `src/lib/coachBots.ts`, `src/lib/coachBots.test.ts`, `src/lib/coachBotJob.ts`.

**Interfaces — Produces:**
```ts
export type BotComment = { name; text; minute; replyTo?; upvotes?: number; poll?: { question: string; options: string[]; votes: number[] } };
export type PromptOptions = { count?; topics?; existing?; polls?: number };   // polls: how many this batch may write (0–2)
export function pollAllowance(batches: number, existingPolls: number, random?: () => number): number[];  // per batch, total 1–2 minus existing, never below 0
```
- [ ] Tests: prompt with `polls: 1` asks for exactly one poll item with 2–4 answers and votes, `polls: 0` forbids polls; `parseBots` keeps a valid poll (trims, 2–4 options, votes clamped 0–40, length matched), drops a poll whose question/answers hit the body filter or teammates' names rule, clamps `upvotes` 0–40 (default from `botUpvotes()` when missing); `pollAllowance(3,0)` sums to 1 or 2, `pollAllowance(2,2)` all 0.
- [ ] `writeBots`: store `bot_upvotes`, insert poll + options with bot votes for poll items; `more` counts the post's existing polls for the allowance. Commit.

### Task 5: Deploy and live test on the Loibl post

- [ ] Full suite, typecheck, build; apply 0005 remotely; push (deploys).
- [ ] Loibl post 900001003: give its existing bot comments uneven `bot_upvotes` (SQL with random buckets), then `POST /api/coach/bots/900001003/?more=4` to add comments including 1–2 polls; check the article page on prod: ▲ counts, polls with bars, voting works.
