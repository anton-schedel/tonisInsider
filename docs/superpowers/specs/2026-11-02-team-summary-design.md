# Team summary on Mein Team — design

## Intent

Mein Team already shows the facts a manager sees anyway: who starts, who's injured, the opponent. The summary
adds what a manager **can't easily see themselves**, because it needs data over time or tedious comparisons:

1. **How far to trust LigaInsider's prediction** for each of their players' clubs.
2. **Rotation risk** around Champions League, Europa League, Conference League and DFB-Pokal games.
3. **What a player's points depend on**, deeper than "scores goals": which kinds of actions make his points, and
   how that fits this week's opponent.

It's written for one moment: **before the matchday's first kickoff**, when Kickbase locks the lineup. After that,
nothing can be changed, so the summary doesn't chase later news.

Example of the tone (the owner's words): *"Your team looks solid with a lot of starters, but several players have
bad matchups, and x, y and z are in danger of rotation because of the Champions League / Europa League."*

## Goals

- A few sentences at the top of Mein Team, about the whole team, naming concrete players.
- Every statement rests on a number we can show (in a detail view or a tooltip), never a guess.
- Written by our own code from rules and templates. An LLM can rewrite it later (the owner may add an xAI or
  Anthropic key if it costs a few cents a month); the facts must already be complete without one.

## Non-goals

- No buy/sell advice, no market-value forecasts (the owner: "too basic, a human knows that").
- No statements a manager sees at a glance anyway ("X is injured").
- No live updates during the matchday.

## Anti-goals

- A summary that sounds clever but rests on two data points. Below a minimum sample, a part says nothing rather than
  something weak. Each part has its own threshold (below).
- Statistics as a table. The owner prefers calm, written insights (see the design memory: no stat cards).

## Data

| Part | Source | History available |
|---|---|---|
| Prediction reliability | `state.predictions` (built 2026-11-02, `scraper/predictions.ts`): the predicted XI per club saved 90 min before the matchday's first kickoff, plus the confirmed XI from LigaInsider's "Aufstellung von …" post | From matchday 9 on (the coming weekend). Meaningful after ~3 matchdays. |
| Rotation | Kickbase `GET /v4/competitions/1/players/{id}/performance`: per Bundesliga matchday the points, minutes (`mp`), status (`st`), date and opponent. European and cup dates from The Odds API events (`soccer_uefa_champs_league`, `soccer_uefa_europa_league`, `soccer_uefa_europa_conference_league`, `soccer_germany_dfb_pokal`; the events endpoint costs no quota) | Bundesliga starts: the whole season. European/cup dates: the API only lists upcoming games, so the scraper must save them from now on (see "Open"). |
| Point profile | Kickbase `GET /v4/competitions/1/playercenter/{id}?day={n}`: each match's events with event type (`eti`) and points; names from `/v4/live/eventtypes` (already used for live points) | The whole season (8 matchdays now). |
| Matchup | Our odds (`state.odds`, `src/lib/odds.ts`): win chances; player odds (`state.scorers`) | Current matchday. |

**Kickbase history (owner's decision):** a one-time backfill of every Bundesliga player's season so far with the
owner's Kickbase account (local `.env`), then the scraper appends each finished matchday with the same account,
stored as GitHub secrets `KICKBASE_EMAIL` / `KICKBASE_PASSWORD` (the owner sets them; never printed or logged).
Stored compactly: per player and match the minutes, start/sub status, opponent, total points and points per action
group, not the raw events. It travels with the store and the site snapshot like the predictions. Mein Team only
reads it, so it doesn't get slower.

## The three parts

### 1. Reliability per club

For each saved matchday and club: how many of the 11 predicted starters were in the confirmed XI (names from the
confirmed text matched to the prediction's players). Per club: the average over the saved matchdays, and how often a
"doubtful" spot went to the predicted player or to his alternative.

Shown when a club has ≥ 3 saved matchdays. In the text: only where it matters, e.g. *"For Leipzig, LigaInsider's
prediction was right for only 7 of 11 on average; Baumgartner's place is less certain than it looks."*

### 2. Rotation risk

A player is at risk this matchday when his club plays a European or cup game within 3 days before or after this
matchday's game, and in the season so far, after (or before) such a game, this player started less often than
usual. Measured from his Kickbase performance (did he start / minutes) on matchdays next to a midweek game vs. the
others.

Shown when the player has ≥ 2 matchdays next to a midweek game. In the text: *"Laimer: Bayern play in Madrid on
Tuesday; after the last two Champions League games he was benched once."*

### 3. Point profile and matchup

From the player's events this season: which share of his points comes from which group of actions (attack:
goals, shots, key passes; duels; defence: tackles, interceptions, clean sheet; goalkeeping; minutes). The groups are
built from Kickbase's event types; the mapping is a fixed table in our code.

**Opponent strength** for a past match is not one number but three, all from the match results in the Kickbase
history (every match's home team, away team and score), as they were *before* that match:
- the table strength (points per game so far),
- home or away: how the opponent does at home vs. away (some teams are much weaker away),
- momentum: points from its last 5 matches.

The player's own home/away split is part of his profile too.

**Recent games count more** (owner: "the last 5 games matter more than the start of the season"). Only this season
is used at all (new players, new coaches). Every average in the point profile, the home/away splits and the table
strength weighs each game by how recent it is: each game counts ~15 % less than the one after it (the 5th-last
still counts about half). The decay is one constant, to be tuned once real data is in. Momentum stays the plain
points of the last 5 matches.

Combined with this week's opponent (win chance from the odds, plus the same three numbers) into one statement per
player where it stands out,
e.g. *"Most of Saibari's points come from attacking actions, and they halved away against teams in form; this
Saturday Bayern play at Union, who won 4 of their last 5 at home."*

Shown when the player has ≥ 4 matches with minutes. Up to 3 players are named, those where the profile and the
matchup point in the same direction most clearly.

## Summary text

- One opening sentence about the team (how many players are in the predicted XI, weighted by their club's
  reliability once it exists).
- Then at most three short sentences: matchups, rotation, reliability. Each only if it has something to say.
- Visible all week up to the matchday's first kickoff, built from LigaInsider's **current** predicted lineups
  (`store.lineups()`). The saved snapshots (`state.predictions`) only feed the reliability score.
- Hidden from the first kickoff until the matchday is over (the lineup is locked; nothing to act on).

## Constraints

- Mein Team's look: calm text, the app's typography, no cards or colour tints (memory: design taste).
- Mein Team must not get slower: the summary loads after the page (its own request, cached), with a quiet
  placeholder.
- The Kickbase account is the only new secret; the scraper fetches only finished matchdays (a few hundred light
  requests once a week), never during the user's page load.

## Decided after the builder check

- **Which players:** the whole Kickbase squad, not only the set eleven: the manager picks the eleven from it.
- **Opponents of past matches** are judged by the three numbers above as they were at the time (owner: "a team
  can also be strong at home or have momentum"), not by today's table.
- **Competitions in Kickbase's performance:** `competitions/1` is the Bundesliga only (its answer is grouped by
  season with `"n": "Bundesliga"`), so a player's "usual starts" are Bundesliga starts. Checked with the test
  account on 2026-11-02.

## Left to the builder

- What exactly Kickbase's `st` values mean (started / came on / didn't play), and the event-type → group table.
- How names in the confirmed XI text ("Minjae") are matched to the predicted players ("Kim Min-jae").
- Wording of the templates.

- **European and cup dates (owner's decision):** collected from now on: the scraper saves the upcoming games of
  the four competitions from The Odds API events once a day. Rotation statements start once a player has
  ≥ 2 matchdays next to a saved midweek game.
