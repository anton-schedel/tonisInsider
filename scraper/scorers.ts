/**
 * Anytime-goalscorer odds per match (The Odds API, US bookmakers; Bundesliga covered).
 * Fetched per match: 1 request each, ≈2 per match per matchday (see scorersToFetch).
 */
import type { OddsEvent } from "./odds.ts";

const HOUR = 60 * 60_000;
/** Matches kicking off within this long of the matchday's first match belong to the same matchday. */
const MATCHDAY_HOURS = 80;
/** One more fetch per match this close to kickoff (late lineup news)… */
const REFRESH_HOURS = 6;
/** …and a retry this often while a bookmaker has no players listed yet. */
const RETRY_HOURS = 6;

/** Thursday 18:00 Berlin time before the matchday: all of its matches get their goal chances together. */
export function matchdayRelease(firstKickoff: Date): Date {
  const parts = (d: Date) => {
    const f = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    return Object.fromEntries(f.formatToParts(d).map((p) => [p.type, p.value]));
  };
  const k = parts(firstKickoff);
  const days = ({ Thu: 0, Fri: 1, Sat: 2, Sun: 3, Mon: 4, Tue: 5, Wed: 6 } as Record<string, number>)[k.weekday];
  // Berlin wall time Thursday 18:00 → UTC (the offset is +1 h or +2 h).
  const wall = Date.UTC(+k.year, +k.month - 1, +k.day - days, 18);
  let utc = wall - HOUR;
  const p = parts(new Date(utc));
  if (+p.hour !== 18) utc = wall - 2 * HOUR;
  // Never later than a day before kickoff (e.g. a matchday that starts on Thursday).
  return new Date(Math.min(utc, firstKickoff.getTime() - 24 * HOUR));
}

/** p: average implied chance to score (still includes the bookmaker margin; calibrated on the site). */
export type ScorerPlayer = { name: string; p: number; books: number };
export type ScorerMatch = { home: string; away: string; kickoff: string; fetchedAt: string; players: ScorerPlayer[] };

export const scorerOddsUrl = (apiKey: string, eventId: string) =>
  `https://api.the-odds-api.com/v4/sports/soccer_germany_bundesliga/events/${encodeURIComponent(eventId)}/odds/?apiKey=${encodeURIComponent(apiKey)}&regions=us&markets=player_goal_scorer_anytime&oddsFormat=decimal`;

type ApiOutcome = { name?: string; description?: string; price?: number };
type ApiBody = {
  home_team?: string;
  away_team?: string;
  commence_time?: string;
  bookmakers?: { markets?: { key?: string; outcomes?: ApiOutcome[] }[] }[];
};

export function parseScorerOdds(json: unknown, now: Date): ScorerMatch {
  const body = (json ?? {}) as ApiBody;
  const implied = new Map<string, number[]>();
  for (const b of body.bookmakers ?? []) {
    for (const m of b.markets ?? []) {
      if (m.key !== "player_goal_scorer_anytime") continue;
      for (const o of m.outcomes ?? []) {
        if (o.name !== "Yes" || !o.description || !(o.price && o.price > 1)) continue;
        const list = implied.get(o.description) ?? [];
        list.push(1 / o.price);
        implied.set(o.description, list);
      }
    }
  }
  return {
    home: body.home_team ?? "",
    away: body.away_team ?? "",
    kickoff: body.commence_time ?? "",
    fetchedAt: now.toISOString(),
    players: [...implied].map(([name, ps]) => ({ name, p: ps.reduce((s, x) => s + x, 0) / ps.length, books: ps.length })),
  };
}

/**
 * Ids of matches to fetch now. All matches of the coming matchday are fetched together from Thursday 18:00,
 * then once more within 6 h of their kickoff; retried every 6 h while no bookmaker lists players yet.
 */
export function scorersToFetch(
  events: OddsEvent[],
  have: Record<string, Pick<ScorerMatch, "fetchedAt"> & { players?: unknown[] }>,
  now: Date,
): string[] {
  const t = now.getTime();
  const upcoming = events.filter((e) => e.id && Date.parse(e.kickoff) > t).sort((a, b) => a.kickoff.localeCompare(b.kickoff));
  if (!upcoming.length) return [];
  const first = Date.parse(upcoming[0].kickoff);
  if (t < matchdayRelease(new Date(first)).getTime()) return [];
  return upcoming
    .filter((e) => {
      const kickoff = Date.parse(e.kickoff);
      if (kickoff - first > MATCHDAY_HOURS * HOUR) return false;
      const got = have[e.id!];
      if (!got) return true;
      const last = Date.parse(got.fetchedAt);
      if (!got.players?.length) return t - last >= RETRY_HOURS * HOUR;
      // The late refresh: due once the match is within 6 h and the last fetch was before that.
      return kickoff - t <= REFRESH_HOURS * HOUR && last < kickoff - REFRESH_HOURS * HOUR;
    })
    .map((e) => e.id!);
}

/** Drops matches that kicked off more than a day ago. */
export function pruneScorers(all: Record<string, ScorerMatch>, now: Date): Record<string, ScorerMatch> {
  return Object.fromEntries(Object.entries(all).filter(([, m]) => Date.parse(m.kickoff) > now.getTime() - 24 * HOUR));
}

/** True if the percentages shown on the site would not change. */
export function sameScorers(a: Record<string, ScorerMatch> | undefined, b: Record<string, ScorerMatch>): boolean {
  const key = (all: Record<string, ScorerMatch>) =>
    JSON.stringify(Object.entries(all).map(([id, m]) => [id, m.players.map((p) => [p.name, Math.round(p.p * 100)]).sort()]).sort());
  return !!a && key(a) === key(b);
}
