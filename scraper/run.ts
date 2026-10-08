import { HttpError, type Fetcher } from "./fetch.ts";
import type { Store } from "./store.ts";
import type { Article, ArticleRef, Category, ClubRef, Lineup } from "./types.ts";
import { BASE_URL, playerOfArticleUrl } from "./text.ts";
import { parseCommentCounts } from "./parse/commentCounts.ts";
import { pinnedIds } from "./pinned.ts";
import { oddsDue, oddsUrl, parseOdds, sameOdds } from "./odds.ts";
import { assistsUrl, parseAssists, parseFullOdds, parseScorerOdds, propsUrl, pruneScorers, sameScorers, scorerOddsUrl, scorersToFetch } from "./scorers.ts";
import { parseNewsList } from "./parse/newsList.ts";
import { NON_PLAYER_SLUGS, parseArticle } from "./parse/article.ts";
import { parseClubs } from "./parse/clubs.ts";
import { parseClubPage } from "./parse/clubPage.ts";
import { validateArticle, validateLineup } from "./validate.ts";
import { bannerKey, ensureImage } from "./images.ts";

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

/** "Vor 2 Std." means 2–3 h ago, so a listing time up to ~1 h after our date is normal. */
const REPUBLISH_TOLERANCE_MIN = 90;

export type RunOptions = {
  store: Store; fetcher: Fetcher; publicDir: string; now: Date; codeVersion?: string;
  /** The Odds API key; without it, win chances are skipped. Never log it: it is part of the request URL. */
  oddsApiKey?: string;
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

export async function run({ store, fetcher, publicDir, now, codeVersion, oddsApiKey }: RunOptions): Promise<RunResult> {
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
        if (overview.category === "bundesliga" && page === 1) firstPage = list.map((r) => r.id);
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

  // 2. Fetch new or re-titled articles.
  const unavailable: Record<string, string> = {};
  const invalid: Record<string, string> = {};
  const cutoff = now.getTime() - RETENTION_DAYS * 24 * 60 * MINUTE;
  for (const { ref, category } of refs.values()) {
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
    if (existing && existing.listHeadline === ref.headline && existing.banner !== undefined && !republished && !missingPlayer) continue;
    if (state.unavailable?.[ref.id] === ref.headline) {
      unavailable[ref.id] = ref.headline;
      continue;
    }
    if (state.invalid?.[ref.id] === ref.headline) {
      invalid[ref.id] = ref.headline;
      continue;
    }
    try {
      const article: Article = parseArticle(await fetcher.text(ref.url), ref, category, now);
      if (listedAt !== undefined) article.listedAt = new Date(listedAt).toISOString();
      const problems = validateArticle(article);
      if (problems.length) {
        result.problems.push(`article ${ref.id}: ${problems.join(", ")}`);
        invalid[ref.id] = ref.headline;
        continue;
      }
      if (article.player) {
        article.player.photo = await ensureImage(fetcher, publicDir, "players", article.player.id, ref.playerPhotoUrl);
      }
      if (article.banner) {
        article.banner = (await ensureImage(fetcher, publicDir, "articles", bannerKey(article.banner), article.banner)) ?? null;
      }
      if (article.club) {
        const club = clubById.get(article.club.id);
        article.club.crest = await ensureImage(fetcher, publicDir, "clubs", article.club.id, club && mediumCrest(club.crestUrl));
      }
      store.putArticle(article);
      result.changed = true;
      if (!existing) result.newArticles++;
    } catch (err) {
      if (err instanceof HttpError && err.status === 404) {
        console.log(`article ${ref.id} is listed but gone (404), skipping`);
        unavailable[ref.id] = ref.headline;
      } else {
        result.problems.push(`article ${ref.id}: ${(err as Error).message}`);
      }
    }
  }
  state.unavailable = unavailable;
  state.invalid = invalid;

  // 3. Lineups.
  if (clubs.length && lineupsDue(store.lineups(), state.lineupsFetchedAt, now)) {
    for (const club of clubs) {
      try {
        const lineup = parseClubPage(await fetcher.text(`${BASE_URL}/${club.slug}/${club.id}/`), club, now);
        const problems = validateLineup(lineup);
        if (problems.length) {
          result.problems.push(`lineup ${club.slug}: ${problems.join(", ")}`);
          continue;
        }
        lineup.club.crest = await ensureImage(fetcher, publicDir, "clubs", club.id, mediumCrest(club.crestUrl));
        for (const p of lineup.lines.flat()) {
          p.photo = await ensureImage(fetcher, publicDir, "players", p.id, p.photoUrl);
          if (p.alternative) {
            p.alternative.photo = await ensureImage(fetcher, publicDir, "players", p.alternative.id, p.alternative.photoUrl);
          }
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
      const odds = parseOdds(JSON.parse(await fetcher.text(oddsUrl(oddsApiKey))));
      if (odds.length && !sameOdds(state.odds, odds)) result.changed = true;
      if (odds.length) state.odds = odds;
    } catch (err) {
      const status = err instanceof HttpError ? err.status : undefined;
      if (status === 401 || status === 403) result.problems.push(`odds: HTTP ${status}, check the ODDS_API_KEY secret`);
      else console.warn(`odds unavailable${status ? ` (HTTP ${status})` : ""}, retrying later`);
    }
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
