/**
 * Anytime-goalscorer odds per match (The Odds API, US bookmakers; Bundesliga covered).
 * Fetched per match: 1 request each, ≈2 per match per matchday (see scorersToFetch).
 */
import type { OddsEvent } from "./odds.ts";

const HOUR = 60 * 60_000;
/** Start fetching a match this long before kickoff… */
const WINDOW_HOURS = 40;
/** …and refresh it after this long (so ≈2 requests per match). */
const REFRESH_HOURS = 24;

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

/** Ids of matches to fetch now: kickoff within 40 h, and not fetched in the last 24 h. */
export function scorersToFetch(events: OddsEvent[], have: Record<string, Pick<ScorerMatch, "fetchedAt">>, now: Date): string[] {
  return events
    .filter((e) => {
      if (!e.id) return false;
      const until = Date.parse(e.kickoff) - now.getTime();
      if (until <= 0 || until > WINDOW_HOURS * HOUR) return false;
      const last = have[e.id]?.fetchedAt;
      return !last || now.getTime() - Date.parse(last) >= (REFRESH_HOURS - 0.1) * HOUR;
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
