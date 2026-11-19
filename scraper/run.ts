import { existsSync } from "node:fs";
import { join } from "node:path";
import { HttpError, type Fetcher } from "./fetch.ts";
import type { Store } from "./store.ts";
import type { Article, ArticleRef, Category, ClubRef, Lineup } from "./types.ts";
import { BASE_URL, articleIdsIn, playerOfArticleUrl } from "./text.ts";
import { parseCommentCounts } from "./parse/commentCounts.ts";
import { pinnedIds } from "./pinned.ts";
import { mergeOdds, oddsDue, oddsUrl, parseOdds, sameOdds } from "./odds.ts";
import { assistsUrl, parseAssists, parseFullOdds, parseScorerOdds, propsUrl, pruneScorers, sameScorers, scorerOddsUrl, scorersToFetch } from "./scorers.ts";
import { parseNewsList } from "./parse/newsList.ts";
import { NON_PLAYER_SLUGS, parseArticle, parseClubCrest } from "./parse/article.ts";
import { hasGrades, pendingGrades } from "./pendingGrades.ts";
import { parseClubs } from "./parse/clubs.ts";
import { parseClubPage } from "./parse/clubPage.ts";
import { canonicalOpponent, fillFromSchedule, fillOpponents } from "./opponents.ts";
import { LIVE_URL, parseLive } from "../src/lib/live.ts";
import { validateArticle, validateLineup } from "./validate.ts";
import { bannerKey, ensureImage } from "./images.ts";
import { recordPredictions } from "./predictions.ts";
import { CUP_COMPETITIONS, cupGamesDue, cupGamesUrl, mergeCupGames, parseCupGames, type CupGame } from "./cupGames.ts";

export const RETENTION_DAYS = 30;
export const BACKFILL_PAGES = 3;
export const CLUB_COUNT = 18;
const MINUTE = 60_000;

// Bundesliga news only: friendly-match news ("Testspiele") only matters around the season start.
export const OVERVIEWS: { category: Category; url: (page: number) => string }[] = [
  {
    category: "bundesliga",
    url: (p) => (p === 1 ? `${BASE_URL}/bundesliga-news/uebersicht/` : `${BASE_URL}/startpage/uebersicht/${p}/`),
  },
];

/**
 * Match reports waiting for their grades (LigaInsider fills them in after the report is out): read again every
 * GRADES_RETRY_MIN while younger than GRADES_WINDOW_DAYS; at most GRADES_READS such reads per run.
 */
const GRADES_WINDOW_DAYS = 3;
const GRADES_RETRY_MIN = 30;
const GRADES_READS = 40;

/** Article pages read per run for the crest of a club outside the Bundesliga (articles stored before it was read). */
const CREST_READS = 10;

/**
 * A listed article whose page answers 404 is read again on every run for this long (LigaInsider lists a new article
 * before its page is out); after that it counts as gone and is skipped until its headline changes.
 */
const UNAVAILABLE_RETRY_MIN = 60;

/** "Vor 2 Std." means 2–3 h ago, so a listing time up to ~1 h after our date is normal. */
const REPUBLISH_TOLERANCE_MIN = 90;

export type RunOptions = {
  store: Store; fetcher: Fetcher; publicDir: string; now: Date; codeVersion?: string;
  /** The Odds API key; without it, win chances are skipped. Never log it: it is part of the request URL. */
  oddsApiKey?: string;
  /** A new article whose page answers 404 is read once more in the same run after this pause; without it, only in the next run. */
  goneRetryMs?: number;
};
export type RunResult = {
  /** Content changed: rebuild and deploy the site. */
  changed: boolean;
  /** Lineups were checked (even if unchanged): the cache must be saved so the timestamp survives. */
  lineupsChecked: boolean;
  /** state.json changed (skip lists, timestamps, code version): the cache must be saved. */
  stateChanged: boolean;
  newArticles: number;
  lineupsUpdated: number;
  problems: string[];
};

/** Lineups refresh every 30 min, or every 10 min if any known kickoff is within the next 48 h. */
export function lineupsDue(lineups: Lineup[], lastFetchedAt: string | undefined, now: Date): boolean {
  if (!lastFetchedAt) return true;
  const soon = lineups.some((l) => {
    if (!l.kickoff) return false;
    const diff = Date.parse(l.kickoff) - now.getTime();
    return diff > -3 * 60 * MINUTE && diff < 48 * 60 * MINUTE;
  });
  const interval = (soon ? 10 : 30) * MINUTE;
  return now.getTime() - Date.parse(lastFetchedAt) >= interval - MINUTE;
}

function withoutTimestamps(l: Lineup | undefined): string {
  return l ? JSON.stringify({ ...l, updatedAt: undefined }) : "";
}

function mediumCrest(url: string): string {
  return url.replace("/teams/small/", "/teams/medium/");
}

export async function run({ store, fetcher, publicDir, now, codeVersion, oddsApiKey, goneRetryMs }: RunOptions): Promise<RunResult> {
  const result: RunResult = {
    changed: false, lineupsChecked: false, stateChanged: false, newArticles: 0, lineupsUpdated: 0, problems: [],
  };
  const state = store.state();
  const stateBefore = JSON.stringify(state);

  // New code (e.g. a parser fix) → rebuild the site and give previously invalid articles another chance.
  if (codeVersion && state.codeVersion !== codeVersion) {
    result.changed = true;
    state.invalid = {};
    state.codeVersion = codeVersion;
  }
  const pages = store.articles().length === 0 ? BACKFILL_PAGES : 1;

  // 1. Collect article refs from the overviews. Bundesliga wins if an article is listed twice.
  const refs = new Map<number, { ref: ArticleRef; category: Category }>();
  const counts: Record<string, number> = { ...state.commentCounts };
  let firstPage: number[] | undefined;
  let clubs: ClubRef[] = [];
  let clubsParsed = false;
  for (const overview of OVERVIEWS) {
    for (let page = 1; page <= pages; page++) {
      try {
        const html = await fetcher.text(overview.url(page));
        const list = parseNewsList(html);
        for (const [id, count] of Object.entries(parseCommentCounts(html))) counts[id] = count;
        if (overview.category === "bundesliga" && page === 1) {
          firstPage = list.map((r) => r.id);
          // What the Worker's minute check compares the overview with (version.json): an id it hasn't got starts a
          // run, so a new one must reach the site even when its article can't be stored (404) — else it starts runs on.
          const ids = articleIdsIn(html);
          const had = new Set(state.listedIds ?? []);
          if (ids.some((id) => !had.has(id))) result.changed = true;
          state.listedIds = ids;
        }
        if (page === 1 && list.length === 0) result.problems.push(`${overview.category}: overview returned 0 articles`);
        if (overview.category === "bundesliga" && page === 1) {
          clubs = parseClubs(html);
          clubsParsed = true;
        }
        for (const ref of list) if (!refs.has(ref.id)) refs.set(ref.id, { ref, category: overview.category });
      } catch (err) {
        result.problems.push(`${overview.category} page ${page}: ${(err as Error).message}`);
      }
    }
  }
  if (clubsParsed && clubs.length < CLUB_COUNT) {
    result.problems.push(`clubs: expected ${CLUB_COUNT}, got ${clubs.length}`);
  }
  const clubById = new Map(clubs.map((c) => [c.id, c]));

  /** Match reports: every rated player's photo and both crests, like the lineups. */
  const ratingImages = async (article: Article) => {
    for (const team of article.ratings ?? []) {
      const club = clubs.find((c) => c.name === team.team);
      team.crest = club ? await ensureImage(fetcher, publicDir, "clubs", club.id, mediumCrest(club.crestUrl)) : undefined;
      for (const spot of team.lines.flat()) {
        for (const p of [spot.player, spot.sub]) {
          if (p) p.photo = await ensureImage(fetcher, publicDir, "players", p.id, p.photoUrl);
        }
      }
    }
  };
  /** Match reports waiting for their grades: when each was last read for them. */
  const gradesTried: Record<string, string> = { ...(state.gradesTriedAt ?? {}) };

  // 2. Fetch new or re-titled articles.
  const unavailable: Record<string, string> = {};
  const unavailableSince: Record<string, string> = {};
  const invalid: Record<string, string> = {};
  const cutoff = now.getTime() - RETENTION_DAYS * 24 * 60 * MINUTE;
  /** Reads one listed article if it is new or changed; true when its page answered 404 for the first time. */
  const readRef = async ({ ref, category }: { ref: ArticleRef; category: Category }): Promise<boolean> => {
    const existing = store.getArticle(ref.id);
    // Re-read when the headline changed, when it was stored before banners existed (banner undefined), or when
    // LigaInsider republished it: the listing time ("Vor 46 Min.") is clearly newer than our date.
    // Compared with the later of its date and the listing time seen at the last read, so an article whose page
    // keeps an older date than the list is read once, not every run.
    const listedAt = ref.listedAgoMinutes !== undefined ? now.getTime() - ref.listedAgoMinutes * MINUTE : undefined;
    const known = existing ? Math.max(Date.parse(existing.publishedAt), existing.listedAt ? Date.parse(existing.listedAt) : 0) : 0;
    const republished = existing && listedAt !== undefined && listedAt - known > REPUBLISH_TOLERANCE_MIN * MINUTE;
    // Articles stored before the player was read from the URL get re-read once (they then have the player).
    const missingPlayer = existing && !existing.player && !!ref.playerName && !!playerOfArticleUrl(ref.url)
      && !NON_PLAYER_SLUGS.has(playerOfArticleUrl(ref.url)!.slug);
    // Match reports stored before their grades were read have the grades as loose text: re-read once.
    const missingRatings = existing && !existing.ratings && /PARADEN|DEFENSIVE/.test(existing.bodyHtml);
    if (existing && existing.listHeadline === ref.headline && existing.banner !== undefined && !republished && !missingPlayer && !missingRatings) return false;
    const goneSince = state.unavailable?.[ref.id] === ref.headline ? state.unavailableSince?.[ref.id] : undefined;
    // Gone for a while (or since before the time was kept): leave it alone.
    if (state.unavailable?.[ref.id] === ref.headline
      && !(goneSince && now.getTime() - Date.parse(goneSince) < UNAVAILABLE_RETRY_MIN * MINUTE)) {
      unavailable[ref.id] = ref.headline;
      if (goneSince) unavailableSince[ref.id] = goneSince;
      return false;
    }
    if (state.invalid?.[ref.id] === ref.headline) {
      invalid[ref.id] = ref.headline;
      return false;
    }
    try {
      const html = await fetcher.text(ref.url);
      const article: Article = parseArticle(html, ref, category, now);
      if (listedAt !== undefined) article.listedAt = new Date(listedAt).toISOString();
      const problems = validateArticle(article);
      if (problems.length) {
        result.problems.push(`article ${ref.id}: ${problems.join(", ")}`);
        invalid[ref.id] = ref.headline;
        return false;
      }
      if (article.player) {
        article.player.photo = await ensureImage(fetcher, publicDir, "players", article.player.id, ref.playerPhotoUrl);
      }
      if (article.banner) {
        article.banner = (await ensureImage(fetcher, publicDir, "articles", bannerKey(article.banner), article.banner)) ?? null;
      }
      await ratingImages(article);
      if (article.club) {
        const club = clubById.get(article.club.id);
        // A club outside the Bundesliga (the national teams): the crest beside the headline.
        article.club.crest = await ensureImage(fetcher, publicDir, "clubs", article.club.id,
          club ? mediumCrest(club.crestUrl) : parseClubCrest(html, article.club));
      }
      store.putArticle(article);
      delete unavailable[ref.id];
      delete unavailableSince[ref.id];
      result.changed = true;
      if (!existing) result.newArticles++;
      // Its grades aren't in yet: read again in half an hour (step 2b).
      if (pendingGrades(article)) gradesTried[article.id] = now.toISOString();
    } catch (err) {
      if (err instanceof HttpError && err.status === 404) {
        console.log(`article ${ref.id} is listed but gone (404), ${goneSince ? "still" : `reading it again for ${UNAVAILABLE_RETRY_MIN} min`}`);
        unavailable[ref.id] = ref.headline;
        unavailableSince[ref.id] = goneSince ?? now.toISOString();
        return !goneSince;
      } else {
        result.problems.push(`download article ${ref.id}: ${(err as Error).message}`);
      }
    }
    return false;
  };
  const justGone: { ref: ArticleRef; category: Category }[] = [];
  for (const entry of refs.values()) if (await readRef(entry)) justGone.push(entry);
  // LigaInsider lists a new article a moment before its page is out: one more try in this run, not only in the next.
  if (justGone.length && goneRetryMs !== undefined) {
    await new Promise((r) => setTimeout(r, goneRetryMs));
    for (const entry of justGone) await readRef(entry);
  }
  // Not when the overview couldn't be read: nothing was listed, and what is remembered would be forgotten.
  if (firstPage) {
    state.unavailable = unavailable;
    state.unavailableSince = unavailableSince;
    state.invalid = invalid;
  }

  // 2b. Match reports stored before LigaInsider filled in their grades: read again from their own URL (a report drops
  // off the list's first page within hours), every half hour while young; older ones get one first try (catch-up).
  // A read without grades changes nothing.
  let gradeReads = 0;
  let graded = 0;
  // Not while the overview fails: its club list gives the reports' crests (and LigaInsider may be down).
  for (const a of clubsParsed ? store.articles().filter((x) => pendingGrades(x)) : []) {
    if (gradeReads >= GRADES_READS) break;
    const last = gradesTried[a.id] ? Date.parse(gradesTried[a.id]) : undefined;
    const young = now.getTime() - Date.parse(a.publishedAt) < GRADES_WINDOW_DAYS * 24 * 60 * MINUTE;
    if (last !== undefined && !(young && now.getTime() - last >= GRADES_RETRY_MIN * MINUTE)) continue;
    gradeReads++;
    gradesTried[a.id] = now.toISOString();
    try {
      const fresh = parseArticle(await fetcher.text(a.url), { id: a.id, url: a.url, headline: a.listHeadline, newsType: a.newsType }, a.category, now);
      if (!hasGrades(fresh)) continue;
      await ratingImages(fresh);
      store.putArticle({ ...a, ratings: fresh.ratings, bodyHtml: fresh.bodyHtml, fetchedAt: now.toISOString() });
      result.changed = true;
      graded++;
    } catch (err) {
      console.warn(`grades of article ${a.id}: ${(err as Error).message}`);
    }
  }
  if (gradeReads) console.log(`grades: ${graded} of ${gradeReads} waiting reports read got their grades`);
  // Only reports still stored and still waiting are remembered.
  state.gradesTriedAt = Object.fromEntries(Object.entries(gradesTried).filter(([id]) => {
    const a = store.getArticle(Number(id));
    return !!a && pendingGrades(a);
  }));

  // 2c. Articles of a club outside the Bundesliga stored without its crest (before it was read from the page):
  // the crest another article of the club brought, else the article's page is read once for it.
  if (clubsParsed) {
    const checked = new Set(state.crestChecked ?? []);
    let reads = 0;
    for (const a of store.articles()) {
      if (!a.club || a.club.crest || clubById.has(a.club.id)) continue;
      const known = `/img/clubs/${a.club.id}.png`;
      let crest = existsSync(join(publicDir, known)) ? known : undefined;
      if (!crest && !checked.has(a.id) && reads < CREST_READS) {
        reads++;
        checked.add(a.id);
        try {
          crest = await ensureImage(fetcher, publicDir, "clubs", a.club.id, parseClubCrest(await fetcher.text(a.url), a.club));
        } catch (err) {
          console.warn(`crest of article ${a.id}: ${(err as Error).message}`);
        }
      }
      if (crest) {
        a.club.crest = crest;
        store.putArticle(a);
        result.changed = true;
      }
    }
    state.crestChecked = [...checked].filter((id) => store.getArticle(id));
  }

  // 3. Lineups.
  if (clubs.length && lineupsDue(store.lineups(), state.lineupsFetchedAt, now)) {
    for (const club of clubs) {
      try {
        const lineup = parseClubPage(await fetcher.text(`${BASE_URL}/${club.slug}/${club.id}/`), club, now);
        if (lineup.opponent) {
          const names = [...new Set([...clubs.map((c) => c.name), ...store.lineups().map((l) => l.club.name)])];
          lineup.opponent.name = canonicalOpponent(lineup.opponent.name, names);
        }
        const problems = validateLineup(lineup);
        if (problems.length) {
          result.problems.push(`lineup ${club.slug}: ${problems.join(", ")}`);
          continue;
        }
        // The same match keeps its kickoff even if a later read can't tell it (the order of the matchday's
        // games, and the live score, hang on it).
        const before = store.getLineup(club.slug);
        // A page that lost the match (LigaInsider glitch around kickoff) keeps the opponent of this matchday.
        if (!lineup.opponent && before?.opponent && (lineup.matchday === undefined || before.matchday === lineup.matchday)) {
          lineup.opponent = before.opponent;
          lineup.matchday ??= before.matchday;
        }
        if (!lineup.kickoff && before?.kickoff && before.matchday === lineup.matchday && before.opponent?.name === lineup.opponent?.name) {
          lineup.kickoff = before.kickoff;
        }
        lineup.club.crest = await ensureImage(fetcher, publicDir, "clubs", club.id, mediumCrest(club.crestUrl));
        for (const p of lineup.lines.flat()) {
          p.photo = await ensureImage(fetcher, publicDir, "players", p.id, p.photoUrl);
          if (p.alternative) {
            p.alternative.photo = await ensureImage(fetcher, publicDir, "players", p.alternative.id, p.alternative.photoUrl);
          }
        }
        // Squad photos: LigaInsider names them like the lineup's (<player slug>-<club>-<season>.jpg). Each player
        // is tried once; a miss (some are spelled differently) stays without photo and isn't asked for again.
        const pattern = lineup.lines.flat().map((p) => p.photoUrl?.match(new RegExp(`^(.*/)${p.slug}(-[^/]+\\.jpg)$`))).find(Boolean);
        const known = new Map([
          ...(before?.squad ?? []).map((p) => [p.id, p.photo] as const),
          ...lineup.lines.flat().flatMap((p) => [[p.id, p.photo] as const, ...(p.alternative ? [[p.alternative.id, p.alternative.photo] as const] : [])]),
        ]);
        for (const p of lineup.squad ?? []) {
          if (known.has(p.id)) p.photo = known.get(p.id);
          else if (pattern) p.photo = await ensureImage(fetcher, publicDir, "players", p.id, `${pattern[1]}${p.slug}${pattern[2]}`);
        }
        if (withoutTimestamps(lineup) !== withoutTimestamps(store.getLineup(club.slug))) {
          store.putLineup(lineup);
          result.changed = true;
          result.lineupsUpdated++;
        }
      } catch (err) {
        result.problems.push(`lineup ${club.slug}: ${(err as Error).message}`);
      }
    }
    // Still without an opponent: the other side's page names it, else the matchday's schedule from OpenLigaDB.
    const all = store.lineups();
    const filled = fillOpponents(all);
    if (all.some((l) => !l.opponent)) {
      try {
        filled.push(...fillFromSchedule(all, parseLive(JSON.parse(await fetcher.text(LIVE_URL)))));
      } catch (err) {
        console.warn(`schedule unavailable: ${(err as Error).message}`);
      }
    }
    for (const l of filled) {
      store.putLineup(l);
      result.changed = true;
    }
    state.lineupsFetchedAt = now.toISOString();
    result.lineupsChecked = true;
  }

  // Clubs that left the league (relegation): drop their lineups, but only when the full list parsed.
  if (clubs.length >= CLUB_COUNT) {
    const current = new Set(clubs.map((c) => c.slug));
    for (const l of store.lineups()) {
      if (!current.has(l.club.slug)) {
        store.deleteLineup(l.club.slug);
        result.changed = true;
      }
    }
  }

  // The predicted XIs as a manager last saw them before the matchday's lineup locks, and later the confirmed ones
  // (before the retention below can drop a lineup post). Not shown yet, so no rebuild: the state carries them.
  const { predictions, changed: predictionsChanged } = recordPredictions(state.predictions, store.lineups(), store.articles(), now);
  if (predictionsChanged) state.predictions = predictions;

  // 4. Retention: drop old articles, unless LigaInsider still lists them (else we'd re-fetch them every run).
  for (const a of store.articles()) {
    if (Date.parse(a.publishedAt) < cutoff && !refs.has(a.id)) {
      store.deleteArticle(a.id);
      result.changed = true;
    }
  }

  // Win chances. Errors are reported by status only: the URL contains the API key.
  if (oddsApiKey && oddsDue(state.oddsFetchedAt, now, state.odds)) {
    state.oddsFetchedAt = now.toISOString();
    try {
      const fresh = parseOdds(JSON.parse(await fetcher.text(oddsUrl(oddsApiKey))));
      const odds = fresh.length ? mergeOdds(state.odds, fresh, now) : fresh;
      if (odds.length && !sameOdds(state.odds, odds)) result.changed = true;
      if (odds.length) state.odds = odds;
    } catch (err) {
      const status = err instanceof HttpError ? err.status : undefined;
      if (status === 401 || status === 403) result.problems.push(`odds: HTTP ${status}, check the ODDS_API_KEY secret`);
      else console.warn(`odds unavailable${status ? ` (HTTP ${status})` : ""}, retrying later`);
    }
  }

  // European and cup games, once a day (the rotation risk around them). Not shown yet: no rebuild.
  if (oddsApiKey && state.odds?.length && cupGamesDue(state.cupGamesFetchedAt, now)) {
    const bundesliga = new Set(state.odds.flatMap((e) => [e.home, e.away]));
    // Games are listed weeks ahead: a competition that fails is simply asked again tomorrow.
    const fresh: CupGame[] = [];
    for (const [sport, name] of Object.entries(CUP_COMPETITIONS)) {
      try {
        fresh.push(...parseCupGames(JSON.parse(await fetcher.text(cupGamesUrl(oddsApiKey, sport))), name, bundesliga));
      } catch (err) {
        const status = err instanceof HttpError ? err.status : undefined;
        console.warn(`${name} games unavailable${status ? ` (HTTP ${status})` : ""}, retrying later`);
      }
    }
    state.cupGames = mergeCupGames(state.cupGames, fresh);
    state.cupGamesFetchedAt = now.toISOString();
  }

  // Player and team odds for the coming matchday, released together on Thursday evening (match ids come from
  // the win-chance odds above); shortly before kickoff only the goalscorer odds are refreshed.
  if (oddsApiKey && state.odds) {
    const before = state.scorers;
    const scorers = pruneScorers({ ...state.scorers }, now);
    for (const { id, kind } of scorersToFetch(state.odds, scorers, now)) {
      try {
        const json = async (url: string) => JSON.parse(await fetcher.text(url)) as unknown;
        if (kind === "assists") {
          scorers[id] = { ...scorers[id], ...parseAssists(await json(assistsUrl(oddsApiKey, id)), now) };
        } else if (kind === "full") {
          scorers[id] = parseFullOdds(await json(propsUrl(oddsApiKey, id)), now);
        } else {
          const fresh = parseScorerOdds(await json(scorerOddsUrl(oddsApiKey, id)), now);
          // Keep the other markets from the full fetch; an empty answer keeps the old goalscorer odds too.
          scorers[id] = { ...scorers[id], fetchedAt: fresh.fetchedAt, ...(fresh.players.length ? { players: fresh.players } : {}) };
        }
      } catch (err) {
        const status = err instanceof HttpError ? err.status : undefined;
        console.warn(`player odds unavailable${status ? ` (HTTP ${status})` : ""}, retrying later`);
      }
    }
    if (!sameScorers(before, scorers)) result.changed = true;
    state.scorers = scorers;
  }

  // Pinned articles (only known when the first overview page loaded).
  if (firstPage) {
    const pinned = pinnedIds(firstPage, store.articles());
    if (JSON.stringify(pinned) !== JSON.stringify(state.pinned ?? [])) result.changed = true;
    state.pinned = pinned;
  }

  // Only for articles we still have; articles that left the overview keep their last known count.
  state.commentCounts = Object.fromEntries(store.articles().filter((a) => a.id in counts).map((a) => [a.id, counts[a.id]]));

  if (result.changed) state.lastChangeAt = now.toISOString();
  store.putState(state);
  result.stateChanged = JSON.stringify(state) !== stateBefore;
  return result;
}
