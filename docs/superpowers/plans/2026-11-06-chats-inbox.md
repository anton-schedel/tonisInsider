# Deine Chats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A chat bubble on News (web + iOS) that opens the last 10 conversations you wrote in, shows their votes, answers and Umfrage results, marks news since you last looked, and jumps into the article to the conversation.

**Architecture:** The Worker records each successful write (`/api/li-comment`, `/api/own-comments/[id]`) per LigaInsider account in a new D1 table `chats`, keyed by conversation (thread + top-level comment). `GET /api/chats/` serves the stored rows with their last known state; `GET /api/chats/[id]/` reads one thread live (one parse per invocation — free plan CPU), stores the state and returns the row; `POST /api/chats/[id]/seen/` copies the state to `seen`. Row texts (German) are worked out on the server, so web and app show the same words.

**Tech Stack:** Astro 7 on Cloudflare Workers (free plan), D1, Vitest with `node:sqlite` for SQL tests; SwiftUI iOS 27, Swift 6, Swift Testing, XcodeGen.

**Spec:** `docs/superpowers/specs/2026-11-06-chats-inbox-design.md`

## Global Constraints

- A chat is one conversation: a top-level comment and everything under it, in which you wrote something.
- List: the last 10 conversations you wrote in (by your last write), shown newest activity first; rows don't move while the list is open.
- News = a new answer from someone else, a change in the votes on anything you wrote there, new votes in your Umfrage. One per chat on the red number.
- Identity: HMAC of the LigaInsider username from the sealed `lic` cookie (`ligaCredentials`), never the readable `lin` cookie; no username stored.
- Only writes through TonInsider are recorded; recording never makes a write fail.
- Copy: "Deine Chats", "Noch keine Chats. Wenn du kommentierst oder eine Umfrage startest, findest du sie hier wieder.", "Melde dich mit LigaInsider an, damit deine Chats hier auftauchen.", "nicht mehr verfügbar", "Spiel vorbei".
- The website changes only by: the bubble on `/`, the `/chats/` page, jump-to-comment on article/club pages, and `root` sent with web replies. Existing endpoints keep their answers.
- Design: calm, Apple-like, gold accent (`--gold`), no stat cards, no colour tints; the jump highlight fades out; light and dark.
- Free plan: at most one LigaInsider thread parse per Worker invocation; refresh skipped when the chat was checked < 60 s ago.
- Clients check for news at most every 3 minutes (web: News page load/visible; app: foreground + loop).
- Never print or commit credentials; remote D1 migrations are run by Toni.

## Review Focus

1. A LigaInsider thread where the conversation sits behind several "Mehr laden" batches: refresh pages through via `next` cursors and finds it; the article jump does the same (max 8 batches).
2. LigaInsider unreachable or slow during refresh: the stored state stays, nothing is marked gone, no error on the row.
3. A conversation whose root was deleted: only a fully read thread without it marks the chat gone (no dot, "nicht mehr verfügbar").
4. Writing again in a known conversation: one row (ids appended), counts as looked-at (seen reset to the next state), moves up.
5. Lineup chat after the match moved on: status "over", no news counted, not tappable.

---

### Task 1: Conversation state and news (pure)

**Files:**
- Create: `src/lib/chats.ts`
- Test: `src/lib/chats.test.ts`

**Interfaces:**
- Produces:
  - `type ConvComment = { id: number; user: string; date: string; text: string; score: number; poll?: { question: string; total: number; options: { label: string; pct: number }[] }; replies: ConvComment[] }` (LigaInsider `Comment` and `OwnComment` both fit)
  - `type ChatState = { mine: Record<string, number>; answers: number; others: number[]; latest?: { user: string; text: string; date: string }; poll?: { total: number; leader?: { label: string; pct: number } }; to?: string; gone?: true }`
  - `type ChatNews = { answers: number; votes: number; poll: number }`
  - `conversationState(root: ConvComment, mine: number[], started: boolean): ChatState`
  - `chatNews(state: ChatState | undefined, seen: ChatState | undefined): ChatNews | undefined` (undefined = nothing new)
  - `chatLines(c: { kind: ChatKind; text: string; started: boolean; state?: ChatState; news?: ChatNews; status: ChatStatus }): { mine: string; status: string }`
  - `type ChatKind = "comment" | "poll" | "answer"`, `type ChatStatus = "ok" | "gone" | "over"`
  - `textStart(s: string, max = 80): string` (one line, "…" when cut)
  - `chatAccount(username: string, key: string): Promise<string>` (hex HMAC-SHA256 of `chats:${username.trim().toLowerCase()}`)

- [ ] **Step 1: Write failing tests** in `src/lib/chats.test.ts`:
  - `conversationState` on a root by you (id 1, score 9, poll total 48 with options Guirassy 64 / Beier 28 / Adeyemi 8) with replies Kalle (id 3, newer) and Mats (id 2), nested reply by you (id 4 under 2): `mine` = `{1: 9, 4: <score>}`, `answers` = 3, `others` = [2, 3], `latest.user` = "Kalle", `poll` = `{ total: 48, leader: { label: "Guirassy", pct: 64 } }`, `to` = "Mats_09" (parent of your newest answer).
  - root by someone else (you answered): root's score not in `mine`, no `poll` even if the root has one, `to` = root's user.
  - `chatNews(state, undefined)` → undefined; new answer id → `{answers: 1, votes: 0, poll: 0}`; your score 9→12 → `votes: 3`; a comment of yours missing in `seen.mine` doesn't count; poll 48→54 → `poll: 6`; equal → undefined.
  - `chatLines`: started poll → mine `"Umfrage: Wer startet im Sturm?"`; answer with `to` → `"Du antwortest Kalle: …"`; comment → `"Du: …"`. Status without news: `"▲ 14 · 3 Antworten"`, poll `"48 Stimmen · Guirassy 64 % · 2 Antworten"`, `"keine Antworten"`, `"1 Antwort"`. With news (joined " · "): one answer → `"Kalle: „Glaub ich erst…“"` (text start 40), several → `"2 neue Antworten"`, votes → `"▲ +3"` / `"▲ −1"`, poll → `"+6 Stimmen · Guirassy 64 %"`. `gone` → `"nicht mehr verfügbar"`; `over` → `"Spiel vorbei · " + summary`; no state → `""`.
  - `chatAccount("Toni ", k)` equals `chatAccount("toni", k)`, differs for another key, is 64 hex chars.
- [ ] **Step 2:** `npx vitest run src/lib/chats.test.ts` → FAIL (module missing).
- [ ] **Step 3:** Implement `src/lib/chats.ts`. Leader = highest pct, first on a tie, only when total > 0. `others` keeps tree order (ascending ids not required). `latest` = newest by date among others' answers. `to` = user of the parent of your newest (by date) answer; undefined when your newest write is the root.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(chats): conversation state, news and row texts`.

### Task 2: D1 table and storage

**Files:**
- Create: `migrations/0008_chats.sql`, `src/lib/chatsDb.ts`
- Test: `src/lib/chatsDb.test.ts` (node:sqlite D1 shim like `coachDb.test.ts`, plus `batch` and `last_row_id`)

**Interfaces:**
- Consumes: `ChatState`, `ChatKind` (Task 1).
- Produces:
  - Table `chats(id INTEGER PK AUTOINCREMENT, account TEXT NOT NULL, thread TEXT NOT NULL, root INTEGER NOT NULL, mine TEXT NOT NULL /*JSON ids*/, started INTEGER NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL, place TEXT NOT NULL /*JSON ChatPlace*/, wrote_at TEXT NOT NULL, activity_at TEXT NOT NULL, state TEXT, seen TEXT, checked_at TEXT, UNIQUE(account, thread, root))`, index `(account, wrote_at)`.
  - `type ChatPlace = { title: string; href: string; club?: { name: string; slug: string; crest?: string }; own?: boolean }`
  - `type ChatWrite = { thread: string; root: number; id: number; kind: ChatKind; text: string; place: ChatPlace }`
  - `type ChatRow = { id: number; thread: string; root: number; mine: number[]; started: boolean; kind: ChatKind; text: string; place: ChatPlace; wroteAt: string; activityAt: string; state?: ChatState; seen?: ChatState; checkedAt?: string }`
  - `KEEP = 20`, `SHOWN = 10`
  - `recordWrite(db: D1, account: string, w: ChatWrite, now: Date): Promise<void>`
  - `listChats(db: D1, account: string): Promise<ChatRow[]>` — the SHOWN newest by `wrote_at`, ordered by `activity_at` desc.
  - `getChat(db: D1, account: string, id: number): Promise<ChatRow | undefined>`
  - `saveState(db: D1, account: string, id: number, state: ChatState, now: Date): Promise<void>`
  - `markSeen(db: D1, account: string, id: number): Promise<void>`

- [ ] **Step 1: Failing tests:** first write creates a row (`started` true for comment/poll with `root === id`, false for an answer); a second write in the same conversation keeps one row, appends the id once, updates `kind`/`text`/`wrote_at`/`activity_at`, clears `seen`; 21 conversations → 20 kept (oldest `wrote_at` dropped); `listChats` returns 10, ordered by `activity_at`; another account sees nothing and can't `getChat`/`markSeen` a foreign id; `saveState` sets `state`, `checked_at`, `activity_at` = max(`wrote_at`, `state.latest.date`) and `seen` = state only when `seen` was null; `markSeen` copies `state` to `seen`.
- [ ] **Step 2:** `npx vitest run src/lib/chatsDb.test.ts` → FAIL.
- [ ] **Step 3:** Write the migration (header comment like 0005) and `chatsDb.ts`; upsert via `INSERT … ON CONFLICT(account, thread, root) DO UPDATE`, merge `mine` in TS after reading the row (one account writes rarely).
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(chats): D1 table for your conversations`.

### Task 3: Recording writes

**Files:**
- Create: `src/lib/chatsServer.ts`
- Modify: `src/lib/snapshotServer.ts` (add `loadAppFeed(url: URL): Promise<AppFeed | undefined>`, cached per isolate and BUILD_ID like `loadSnapshot`), `src/pages/api/li-comment.ts`, `src/pages/api/own-comments/[id].ts`
- Test: `src/lib/chatsServer.test.ts`

**Interfaces:**
- Consumes: `recordWrite`, `ChatWrite`, `ChatPlace` (Task 2), `chatAccount`, `textStart` (Task 1), `threadKey`, `parseThreadKey`.
- Produces:
  - `chatPlace(feed: AppFeed | undefined, thread: string): ChatPlace` — article → `{ title: headline, href: "/artikel/<id>/", club, own }`; lineup key → `{ title: "Aufstellung <club>", href: "/vereine/<slug>/", club }`; unknown → `{ title: "Beitrag", href: "/" }`.
  - `ligaWrite(action: LiAction, thread: string, commentId: number | undefined, root: unknown): Omit<ChatWrite, "place"> | undefined` — comment/poll: root = commentId; reply: root = valid `root` or the replied-to id; votes → undefined; no commentId → undefined.
  - `recordChat(cookies: CookieJar, url: URL, w: Omit<ChatWrite, "place">): Promise<void>` — account from `ligaCredentials(cookies, env.CREDENTIALS_KEY)`; no account or DB → nothing; any error is logged (kind only) and swallowed.
  - `accountOf(cookies: CookieJar): Promise<string | undefined>` (shared with Task 4).

- [ ] **Step 1: Failing tests** for `chatPlace` (article, lineup thread, own post, unknown) and `ligaWrite` (comment, poll text = question, reply with/without/invalid root, vote/pollvote → undefined, missing commentId → undefined).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement; in `li-comment.ts` after a successful `runAction` call `recordChat` (awaited inside try/catch, after the answer is known, before responding); parse `commentId` as a number (LigaInsider sends text). In own-comments POST record `{ thread: String(id), root: c.parent ?? newId, id: newId, kind: poll ? "poll" : c.parent ? "answer" : "comment", text }`.
- [ ] **Step 4:** `npx vitest run src/lib/chatsServer.test.ts src/lib/comments.test.ts` → PASS; `npm run typecheck` clean.
- [ ] **Step 5:** Commit `feat(chats): remember what you write through TonInsider`.

### Task 4: Chats API

**Files:**
- Create: `src/pages/api/chats/index.ts` (GET list), `src/pages/api/chats/[id].ts` (GET refresh), `src/pages/api/chats/[id]/seen.ts` (POST), `src/lib/chatsApi.ts`
- Test: `src/lib/chatsApi.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3 (`getChat`, `listChats`, `saveState`, `markSeen`, `conversationState`, `chatNews`, `chatLines`, `accountOf`, `loadAppFeed`), `fetchComments`, `fetchMoreComments`, `cursorFrom`, `loadThreads`.
- Produces (JSON for both clients):
  - `type ChatView = { id: number; place: ChatPlace; link: string /* place.href + "#c<root>" */; started: boolean; kind: ChatKind; activityAt: string; status: ChatStatus; news?: ChatNews; lines: { mine: string; status: string }; checked: boolean /* has a state */ }`
  - `chatView(row: ChatRow, feed: AppFeed | undefined): ChatView` — status `gone` when `state.gone` or (numeric thread) article not in the feed; `over` for a `t…` thread that no current lineup has; `news` only when status is `ok`.
  - `GET /api/chats/` → `{ signedIn: false, chats: [] }` without account, else `{ signedIn: true, chats: ChatView[] }`.
  - `refreshState(row: ChatRow, deps: { liga(thread, cursor?): Promise<Comments>; own(postId): Promise<{ comments: OwnComment[] }> }, cursor?: MoreCursor): Promise<{ state: ChatState } | { next: MoreCursor }>` — finds the top-level comment `root`; not found with `more` → `{ next }`; not found at the end → `{ state: { ...row.state ?? empty, gone: true } }`.
  - `GET /api/chats/<id>/[?offset&goffset&moffset&cursor]` → `{ chat: ChatView }` or `{ next: MoreCursor }`; 404 for a foreign/missing id; skips the read and returns the stored view when `checked_at` < 60 s and no cursor; LigaInsider failure → 502 `{ error }`, nothing saved. Reads LigaInsider without the viewer's cookie (scores, answers and poll totals don't depend on it).
  - `POST /api/chats/<id>/seen/` → `{ ok: true }`; same-origin check for cookie requests (`isSameOrigin`, like li-comment).

- [ ] **Step 1: Failing tests:** `chatView` statuses and `link`; `refreshState` found in the first batch, found after one `next`, thread ended without it → gone, own post via `own()`; the 60 s skip is a pure helper `fresh(checkedAt, now)` tested at 59 s / 61 s.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement the module and the three routes (`prerender = false`, `json`/`notAllowed` from `http.ts`).
- [ ] **Step 4:** `npm test` → all pass; `npm run typecheck` clean.
- [ ] **Step 5:** Commit `feat(chats): the chats endpoints`.

### Task 5: Website — bubble, list page, jump to the conversation

**Files:**
- Create: `src/components/ChatsBubble.astro`, `src/pages/chats.astro`, `src/lib/chatsClient.ts`
- Modify: `src/layouts/Base.astro` (prop `chats?: boolean`, bubble left of the wordmark), `src/pages/index.astro` (`chats`), `src/lib/commentUi.ts` (`li.dataset.commentId`, export `jumpTarget(): number | undefined` from `#c<id>` and `highlight(li)`), `src/components/Comments.astro` (send `root` with replies; after load jump: find `[data-comment-id]` among top-level items, `loadMore` up to 8 times until found, scroll to centre, highlight), `src/components/OwnComments.astro` (same jump, no paging), `src/styles/global.css` (`.comment-target` gold fade 2.4 s, none with reduced motion; `.chats-badge`)
- Test: `src/lib/chatsClient.test.ts` (pure parts)

**Interfaces:**
- Consumes: the API of Task 4.
- Produces: `chatsClient.ts`: `loadChats(): Promise<{ signedIn: boolean; chats: ChatView[] }>`, `refreshChat(id: number): Promise<ChatView | undefined>` (follows `next` up to 8 times), `markSeen(id: number): void` (`fetch` with `keepalive`), `badgeCount(chats: ChatView[]): number` (news && status ok), `dueCheck(last: number | undefined, now: number): boolean` (3 min).

- [ ] **Step 1: Failing tests** for `badgeCount`, `dueCheck`, and `jumpTarget` ("#c123" → 123, "#x", "" → undefined).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. Bubble: round 36 px `bg-surface` button with a speech-bubble SVG, red number (`--red-card`, white text) when > 0, only fetches when `liin=1`; checks on `astro:page-load` and `visibilitychange` when `dueCheck` (last check in `sessionStorage`, try/catch). `/chats/` page (static, `Base` with back to News, title "Deine Chats"): shows stored rows at once, then refreshes each (3 at a time) and updates the row in place; row = crest/club or TonInsider logo, title (1 line), `lines.mine` (muted), `lines.status` (bold with gold dot when news), relative time from `activityAt` (`ago`); tap → `markSeen` then `navigate(link)`; `over` rows not links. Empty and signed-out texts from Global Constraints.
- [ ] **Step 4:** `npm test` and `npm run typecheck` pass; `npm run build` succeeds; check in the browser (dev server) light and dark: bubble, list, jump into an article with a hash.
- [ ] **Step 5:** Commit `feat(chats): bubble, Deine Chats and jump to your conversation on the website`.

### Task 6: iOS app

**Files:**
- Create: `ios/TonInsider/Chats/ChatsModel.swift`, `ios/TonInsider/Chats/ChatsView.swift`, `ios/TonInsiderTests/ChatsTests.swift`
- Modify: `Design/Components.swift` (`PageHeader` gains an optional trailing accessory before the wordmark), `News/NewsView.swift` (bubble → `ChatsRoute`), `App/RootView.swift` (NewsStack/LineupsStack use `NavigationPath`), `Lineups/LineupsView.swift` (routes: `ChatsRoute`, `ArticleRoute(id:, comment: Int? = nil)`, `ClubRoute(slug:, comment: Int? = nil)`), `Article/ArticleView.swift` and `Lineups/ClubView.swift` (pass `focus`), `Comments/CommentsSection.swift` + `CommentsModel.swift` (`reveal(_ id: Int) async -> Bool`: loads more up to 8 times until the top-level comment is there; rows get `.id("c\(id)")`; the found row highlights gold and fades), `App/TonInsiderApp.swift` (ChatsModel in the environment; check on active and every 3 min)

**Interfaces:**
- Consumes: Task 4 JSON (`ChatView`), the API's bearer session.
- Produces: `ChatsModel` (`@Observable @MainActor`): `chats: [ChatView]`, `signedIn: Bool`, `badge: Int`, `load() async`, `refreshAll() async` (3 at a time, rows replaced in place by id, order kept), `check(now:) async` (3 min throttle), `markSeen(_ id: Int) async`; `ChatView: Decodable, Identifiable` mirroring Task 4.

- [ ] **Step 1: Failing tests** (`ChatsTests` under `NetworkTests`): decoding a sample `/api/chats/` answer; `badge` counts only `news` with status ok; `refreshAll` keeps order and follows `next`; `check` skips within 3 min; `CommentsModel.reveal` pages until the id is there and stops after 8.
- [ ] **Step 2:** `xcodebuild test` (TI iPhone 27 simulator) → FAIL.
- [ ] **Step 3:** Implement. Bubble: 36 pt circle `tiSurface`, SF Symbol `bubble.left`, red number badge; `.press`. List rows like the web, `.pressRow`, tap → `markSeen` + push `ArticleRoute(id:comment:)` / `ClubRoute(slug:comment:)` from `place.href`; `over` rows not tappable.
- [ ] **Step 4:** Tests pass; screenshot the list and a jump in the simulator (light/dark).
- [ ] **Step 5:** Commit `feat(ios): Deine Chats with the bubble on News and jump to your conversation`.

### Task 7: Ship

- [ ] Full suites: `npm test`, `npm run typecheck`, `npm run build`, `xcodebuild test`.
- [ ] Final whole-branch review (fresh reviewer), fix Critical/Important.
- [ ] Toni runs `npx wrangler d1 migrations apply <db> --remote` (0008) before the deploy; then merge to main (push deploys); install the app on the iPhone.
