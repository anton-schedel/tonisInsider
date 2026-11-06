# Deine Chats: your comments in one place — design

## Intent

Toni and friends write comments, answers and Umfragen under articles: LigaInsider threads, and the comments
under our own and the coach's Schnöselmob posts. Later they want to go back and see how it's going: how many
votes their comment got, what people answered and how those answers are voted, and where their Umfrage stands
now. Today that means finding the article again and scrolling down to the comment.

The idea comes from Instagram's DM button: a chat bubble at the top right of the News page opens "Deine Chats",
a list of your last ten things you wrote, each shown like a chat. A red number on the bubble says how many of them
have news. Tapping a chat takes you straight to that spot in the article.

## Goals

- **Bubble on News** (website `/` and the iOS app's News tab): a round chat-bubble button in the page header,
  left of the TonInsider wordmark. A red number on it counts the chats with news since you last looked. No
  number when there's nothing new.
- **A chat is one conversation** (decided): a top-level comment and the answers under it, in which you wrote
  something: you started it (a comment or an Umfrage), or you answered in it. Your comment, Kalle's answer and
  your answer to Kalle are one chat, not two. Several answers of yours in the same conversation stay one chat.
- **"Deine Chats" list:** the last 10 conversations you wrote in through TonInsider. Under LigaInsider articles
  (and LigaInsider lineup-page threads) and under our own/Schnöselmob posts.
- **Order (my call):** newest activity first, where activity is the newest answer's time or your own last write,
  as last known. Rows don't move while the list is open: each chat's current state fills in as it arrives (bold,
  dot, numbers), and the order follows it the next time the list opens. This needs the server to remember each
  chat's last known state and activity time (see Data).
- **Each row shows:** the article (club crest or Schnöselmob mark, title), the start of what you wrote last (or
  "Umfrage: <question>" if you started one, or "Du antwortest <name>: …" if your last word was an answer), and
  what's happening now: votes on your comment (if you started it), number of answers, the newest answer's start
  and time, and for your Umfrage the number of votes and the leading option with its %.
- **News since you last looked** = any of these changed since you last opened that chat: a new answer in the
  conversation that isn't yours, the votes on anything you wrote in it, new votes in your Umfrage (decided: votes
  count too, not only answers). Such a row is bold with a gold dot and says what's new; it counts once toward the
  red number however much happened in it.
- **Tapping a row** opens the normal article and scrolls straight to the conversation (its top comment, with the
  answers open), which lights up gold for a moment and then settles. If it is behind "Mehr laden", more is loaded
  until it's reached. Opening it marks the chat as seen. (Decided: the article, not a separate chat page.)
- **Lineup-page chats after the match (my call):** the club page only shows the current match's thread
  (`Lineup.comments`, "changes with each match"). Once the club page has moved on, such a chat stays in the list
  with its current votes and answers (still readable through `/api/comments/t…`), labelled "Spiel vorbei", and
  can't be tapped. It leaves the list with time like any other.
- **Follows you between devices** (decided): the list and the "seen" state live on our server, so the iPhone app
  and the website show the same chats and the same news.
- Both apps get it: the website and the native iOS app, same behaviour, each in its own native style.

## Non-goals

- Comments written before this ships, or written directly on ligainsider.de: LigaInsider has no "my comments"
  list we can read and shows only a username per comment, so we can only remember what is posted through
  TonInsider.
- Push notifications (wanted later). Data and "news" detection should not block adding them later.
- Direct messages between people, a chat page of its own, writing from the list.
- Other people's votes on other people's answers don't count as news (only votes on what you wrote, new answers
  from others, your Umfrage's votes).

## Anti-goals

- The website must not change otherwise: no other page looks or behaves differently, existing endpoints keep
  their behaviour (they may additionally record what was written, see below).
- No noise: one red number for chats, not per vote; seen is seen on all devices.
- No stat cards, no colour tints, no gradients; calm, Apple-like, gold accent (owner's taste, see the iOS and team
  summary designs). The gold highlight on the jumped-to comment fades; it doesn't stay as a tinted box.
- Never trust a client-readable cookie for who someone is (see Identity).

## Identity — whose chats (my call, open to change)

The list is tied to the **LigaInsider login**. Writing in a LigaInsider thread needs it anyway. A comment under one
of our own posts (which anyone can write under a free name) is recorded when the writer is signed in to
LigaInsider at that moment; otherwise it isn't recorded. Without a LigaInsider login the bubble still shows; the
list then says to sign in (link to Einstellungen).

The identity must come from something only the Worker can read: the sealed `lic` cookie (username + password,
AES-GCM with `CREDENTIALS_KEY`, set at every LigaInsider login by `rememberLiga`) — or, in the app, the same jar
inside the bearer token. Not the readable `lin` cookie. Store an HMAC/hash of the normalized username, not the
username itself (the repo is public and nothing account-specific is committed; the database shouldn't hold more
than needed). Risk for the builder to check: someone logging in with their email on one device and username on
the other would get two lists; normalize to one account key if LigaInsider lets us tell (e.g. the username on
the comment LigaInsider returns), otherwise note it as a known limit.

## Data

**Recording what you wrote.** When a comment, answer or Umfrage is posted successfully through TonInsider, the
server records it for that account, keyed by conversation: thread (the existing thread key: article id or `t…`
lineup key, or our own post id) plus the conversation's top-level comment id (your own comment's id when you
start one; the parent's id when you answer — LigaInsider returns the new comment's id from `/api/li-comment`, our
own D1 comments have theirs). Also the ids of what you wrote in it (to find "votes on what you wrote" and to tell
your answers from others'), whether you started an Umfrage there, a short start of your last text, the article
title/club for the row, and the time of your last write. Both web and app already post through the same
endpoints (`/api/li-comment`, `/api/own-comments/[id]`), so recording there covers both. Only the newest
conversations matter: keep at most a small number per account (e.g. 10–20) and drop older ones. Threads on our
own posts are one level deep (answers only to top-level comments); LigaInsider's can nest — everything under the
top-level comment belongs to the conversation.

**Seen state and last known state.** Per chat, a small snapshot of what you saw when you last opened it (the
scores of what you wrote, the ids of others' answers, the Umfrage's total votes). "News" = the current state
differs from it. Separately, the last known state and activity time, so the list can show and order rows at once
before the live reads arrive. Both stored on the server per account and chat; seen is written when a chat is
opened (from either device), the last known state whenever a client has read the current one (or the server
compares — builder's call within the CPU limit).

**Current state.** Read live from the thread, the way the article already reads its comments: LigaInsider through
`/api/comments/[id]` (+ `/more` paging), our own posts through `/api/own-comments/[id]`. Votes in our own threads
include the bots' growing votes, as the article shows them.

**New D1 table(s):** a migration `migrations/0008_…sql` (Toni runs remote migrations; the builder writes
it and says so).

## Where things show up

- **Website:** the bubble in `Base.astro`'s header on the News page (`/`), the list as its own page or a sheet over
  News (builder's call; it must work as the home-screen web app). The article page `/artikel/[id]/` (and lineup
  threads on `/vereine/[slug]/`) accepts a target comment (e.g. `#c<id>` or `?c=<id>`), loads its comments, pages
  until it finds it, scrolls there and highlights it.
- **iOS app:** the bubble in News' `PageHeader`, the list pushed on the News stack (system back swipe), tapping
  pushes `ArticleView` (or the club page for a lineup thread) scrolled to the comment with the same highlight.
  The red number refreshes when the app becomes active and with the feed's 30 s refresh at most every few minutes
  (builder's call on the interval).
- Wording in German, matching the site: "Deine Chats", "Du", "Umfrage", "neu", "Antworten", "Stimmen".
- Empty list: "Noch keine Chats. Wenn du kommentierst oder eine Umfrage startest, findest du sie hier wieder."
  Not signed in to LigaInsider: "Melde dich mit LigaInsider an, damit deine Chats hier auftauchen." with a link.
- A chat whose comment or article is gone (deleted on LigaInsider, article dropped from the feed): shows
  "nicht mehr verfügbar" and no dot; it leaves the list with time.

## Constraints

- Cloudflare free plan: ~10 ms CPU per Worker invocation. Parsing up to ten LigaInsider threads in one request
  is likely too much: read the current state per thread (one request per chat, edge-cached like the article's
  comments today), not all ten in one invocation. LigaInsider's answer times vary from 0.3 to 12 s; the list
  shows the stored rows at once and fills in each chat's current state as it arrives.
- LigaInsider load: don't fetch ten threads every 30 s per user. Badge checks run on open/foreground and at a
  modest interval; reuse the existing edge cache (120 s) where possible.
- The web stays as it is apart from the bubble, the list and the jump-to-comment.
- Existing patterns: app requests through the bearer-token session adapter (`src/lib/appSession.ts`), writes
  checked with `isSameOrigin` for cookie requests, Vitest for the server, Swift Testing for the app, the iOS
  app's `FeedStore`/`CommentsModel` patterns.
- Never print or commit tokens or credentials; no account-specific data in the repo.

## Left to the builder

- Table layout, how many entries to keep, endpoint names and shapes (e.g. `GET /api/chats`, `POST
  /api/chats/seen`), and whether the client or the server compares current state with the seen snapshot (the
  CPU limit above favours per-thread reads).
- The bubble icon (SF Symbol in the app, an equivalent SVG on the web) and the exact row layout, following the
  mockup Toni approved (bubble left of the wordmark; rows with crest, title, your text, what's new, gold dot;
  tapping jumps into the article).
- How the page finds a comment deep in a long thread (paging limit, what to show if it isn't found).
