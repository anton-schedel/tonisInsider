# Upvotes and polls under our own posts

Date: 2026-10-24. Status: for approval.

## Why

TonInsider's own posts (TuS Schnöselmob: the coach's posts in D1 and the hand-written ones in `content/posts/`) are
read by the owner's friends, often together at parties, for fun. Their comment section should look and work like
a normal LigaInsider post on TonInsider: upvotes on comments and polls. The bots that already write comments
under the coach's posts should take part: their comments arrive with upvotes, and they create polls of their own
("Loibl raus??? Ja / Nein") that people can vote in.

Success: a Schnöselmob post's comments are indistinguishable in look and behaviour from a LigaInsider article's
comments on TonInsider (`src/components/Comments.astro`), except that they are stored in our own D1 database and
need no login.

## Goals

- **Upvotes**: every comment under an own post shows `▲` and a count, like LigaInsider comments
  (`voteControl` in `Comments.astro`). A visitor can upvote a comment once and take the upvote back by tapping
  again. Only up, no down (LigaInsider shows only up).
- **Polls**: when writing, a visitor can switch "Kommentar | Umfrage" (the same segmented control as in
  `Comments.astro`) and write a question with 2 to 6 answers. Everyone can vote once per poll; results show as
  bars with percentages and a total, the voter's choice marked with ✓ (same markup and classes as `renderPoll`).
- **Bot upvotes**: each bot comment gets a number of bot upvotes, spread unevenly like a real forum (most a few,
  some none, a good joke 15 or more). Real upvotes add to them.
- **Bot polls**: when the bots write a post's comments, one or two of them are polls fitting the post and its
  mood, with 2 to 4 answers and bot votes per answer. Real votes add to them.
- **Visitors get bot votes too** (owner's decision): a visitor's comment gets bot upvotes and a visitor's poll
  gets bot votes per answer, assigned by the Worker when it's saved (random, uneven, no model call), growing like
  the bots' own. Nothing on the page tells real and bot votes apart.
- **Bot votes grow**: bot upvotes and bot poll votes don't all show at once. Visible bot votes grow from 0 to
  their full number over the 30 minutes after the comment appears (a pure function of time, nothing stored per
  minute).
- **Rules**: the bots' limits (no looks, weight, origin, religion, sexuality, illness; no teammates' names as
  bot names; the body-insult filter) apply to poll questions and answers too.
- **Coach**: deleting a comment on the coach page also deletes its poll and votes.

## Existing posts (owner's decision)

- The posts already out (0:2, Torres, Kowol and the others) stay as they are: no backfilled upvotes, no polls.
- Exception, as the live test: the latest Loibl post (id 900001003) gets bot upvotes on its existing bot comments
  (fully grown, since they're old) and one or two bot polls, done on production after the deploy.

## Non-goals

- Downvotes, logins, editing comments or polls.
- Changing LigaInsider's comments or `Comments.astro`'s behaviour for LigaInsider articles.
- Votes or polls under LigaInsider articles stored in our database.

## Anti-goals

- Anything that makes the bots obvious: identical vote counts, all votes appearing in the first second, every
  post with the same number of polls.
- A second, diverging copy of the comment UI that drifts from `Comments.astro`'s look.

## Constraints

- Cloudflare Worker + D1 (`COMMENTS` binding), Astro 7, Tailwind 4; repo public and code-only.
- No login: a visitor is identified by a random id in a long-lived cookie set by the Worker on the first vote
  (HttpOnly, Secure, SameSite=Lax). Rate limits use the existing hashed-IP sender key (`senderKey`).
- Comment and poll text is untrusted: rendered with `textContent` only, as now.
- Existing comment API stays compatible: `GET /api/own-comments/<id>/` keeps `total` and `comments` and adds
  fields.
- Comments dated in the future (planned bot comments) stay hidden, and so do their polls and votes.
- "Fast and smooth" is the site's standing bar: voting updates the page at once (optimistic), the network call
  follows.

## Decided

- Look: copy `Comments.astro`'s comment row, vote button and poll markup and classes; no LigaInsider API calls.
- Bot content comes from the same model call that writes the bot comments (one JSON list): each item may carry
  `upvotes` (a number) and `poll` (`question`, `options`, and bot votes per option).
- How many polls: one or two per post, decided by the model within that range.

## Builder's calls (made while writing this up)

- **Polls per post**: the code decides which of the parallel bot batches (`batchPlan`) may write a poll, so a post
  gets one or two in total. "More comments" (`?more=`) adds a poll only while the post has fewer than two.
- **Growth shown on load**: the Worker computes the visible bot votes at request time; the full bot numbers never
  leave the server. The page doesn't tick up while open (it doesn't load new comments live either).

## Left to the builder

- Table design (suggested: `comment_votes(comment_id, voter)`, `polls(comment_id, question)`,
  `poll_options(id, comment_id, label, bot_votes)`, `poll_votes(comment_id, voter, option_id)`, plus
  `bot_upvotes` on `comments`), migration number 0005.
- Whether the shared rendering moves into a module used by both components or `OwnComments.astro` copies it.
- API shape for voting (suggested: `POST /api/own-comments/<post>/vote` and `.../poll-vote`).
- The exact growth curve over the 30 minutes.
