/**
 * Player and team odds per match (The Odds API, US books). Once per matchday (Thursday evening) a full fetch:
 * anytime goalscorer, assists (→ scorer chance), team totals (→ clean sheets) and cards, 4 credits per match.
 * Shortly before kickoff only the goalscorer odds are refreshed (1 credit), since that's where late lineup
 * news shows.
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

/** p: average implied chance (still includes the bookmaker margin; calibrated on the site). */
export type ScorerPlayer = { name: string; p: number; books: number };
export type ScorerMatch = {
  home: string;
  away: string;
  kickoff: string;
  /** Last fetch of any kind. */
  fetchedAt: string;
  /** Last full fetch (all markets); missing for matches fetched before the full set existed. */
  fullAt?: string;
  /** Anytime goalscorer. */
  players: ScorerPlayer[];
  /** At least one assist; missing for matches fetched before assists were part of the set. */
  assists?: ScorerPlayer[];
  /** Last request for the assists (they sometimes come later than the other markets). */
  assistsAt?: string;
  /** "To receive a card" (US books). */
  cards?: ScorerPlayer[];
  /** Chance (0–1, margin removed) that each team keeps a clean sheet, by the API's team name. */
  cleanSheet?: Record<string, number>;
};

const BASE = "https://api.the-odds-api.com/v4/sports/soccer_germany_bundesliga/events";
const eventUrl = (apiKey: string, eventId: string, regions: string, markets: string[]) =>
  `${BASE}/${encodeURIComponent(eventId)}/odds/?apiKey=${encodeURIComponent(apiKey)}&regions=${regions}&markets=${markets.join(",")}&oddsFormat=decimal`;

/** Goalscorer only (the refresh before kickoff). */
export const scorerOddsUrl = (apiKey: string, eventId: string) => eventUrl(apiKey, eventId, "us", ["player_goal_scorer_anytime"]);
/** Full fetch: goalscorer, assists, team totals (clean sheets), cards. 4 credits. */
export const propsUrl = (apiKey: string, eventId: string) =>
  eventUrl(apiKey, eventId, "us", ["player_goal_scorer_anytime", "player_assists_alternate", "alternate_team_totals", "player_to_receive_card"]);
/** Assists only (asked again while missing; an empty answer costs nothing). */
export const assistsUrl = (apiKey: string, eventId: string) => eventUrl(apiKey, eventId, "us", ["player_assists_alternate"]);

type ApiOutcome = { name?: string; description?: string; price?: number; point?: number };
type ApiBody = {
  home_team?: string;
  away_team?: string;
  commence_time?: string;
  bookmakers?: { key?: string; markets?: { key?: string; outcomes?: ApiOutcome[] }[] }[];
};

/** Average implied chance per player of one player market: its "Yes", or "Over 0.5" (assists). */
export function playerMarket(json: unknown, market: string): ScorerPlayer[] {
  const body = (json ?? {}) as ApiBody;
  const implied = new Map<string, number[]>();
  for (const b of body.bookmakers ?? []) {
    for (const m of b.markets ?? []) {
      if (m.key !== market) continue;
      for (const o of m.outcomes ?? []) {
        const yes = o.name === "Yes" || (o.name === "Over" && o.point === 0.5);
        if (!yes || !o.description || !(o.price && o.price > 1)) continue;
        const list = implied.get(o.description) ?? [];
        list.push(1 / o.price);
        implied.set(o.description, list);
      }
    }
  }
  return [...implied].map(([name, ps]) => ({ name, p: ps.reduce((s, x) => s + x, 0) / ps.length, books: ps.length }));
}

/** Typical margin on a one-sided price (when a bookmaker lists only "Under 0.5"). */
const ONE_SIDED_MARGIN = 1.05;

/**
 * Clean sheets from team totals: "Augsburg under 0.5 goals" is Bayern's clean sheet. Per bookmaker the
 * over/under pair is normalised to remove the margin; averaged over bookmakers.
 */
export function cleanSheets(json: unknown): Record<string, number> {
  const body = (json ?? {}) as ApiBody;
  const { home_team: home, away_team: away } = body;
  if (!home || !away) return {};
  const fair = new Map<string, number[]>();
  for (const b of body.bookmakers ?? []) {
    const outcomes = b.markets?.find((m) => m.key === "alternate_team_totals")?.outcomes ?? [];
    for (const team of [home, away]) {
      const price = (side: string) => outcomes.find((o) => o.name === side && o.description === team && o.point === 0.5)?.price;
      const under = price("Under");
      const over = price("Over");
      if (!(under && under > 1)) continue;
      const p = over && over > 1 ? (1 / under) / (1 / under + 1 / over) : 1 / under / ONE_SIDED_MARGIN;
      const keeper = team === home ? away : home;
      fair.set(keeper, [...(fair.get(keeper) ?? []), p]);
    }
  }
  return Object.fromEntries([...fair].map(([team, ps]) => [team, ps.reduce((s, x) => s + x, 0) / ps.length]));
}

/** Goalscorer-only answer (the refresh before kickoff). */
export function parseScorerOdds(json: unknown, now: Date): ScorerMatch {
  const body = (json ?? {}) as ApiBody;
  return {
    home: body.home_team ?? "",
    away: body.away_team ?? "",
    kickoff: body.commence_time ?? "",
    fetchedAt: now.toISOString(),
    players: playerMarket(json, "player_goal_scorer_anytime"),
  };
}

/** The full fetch. */
export function parseFullOdds(json: unknown, now: Date): ScorerMatch {
  return {
    ...parseScorerOdds(json, now),
    fullAt: now.toISOString(),
    ...parseAssists(json, now),
    cards: playerMarket(json, "player_to_receive_card"),
    cleanSheet: cleanSheets(json),
  };
}

export function parseAssists(json: unknown, now: Date): Pick<ScorerMatch, "assists" | "assistsAt"> {
  return { assists: playerMarket(json, "player_assists_alternate"), assistsAt: now.toISOString() };
}

/** full: all markets (4 credits); goals: the goalscorer refresh (1); assists: asked again (1, free while empty). */
export type ScorerFetch = { id: string; kind: "full" | "goals" | "assists" };

/**
 * What to fetch now. All matches of the coming matchday get the full set together from Thursday 18:00
 * (retried every 6 h while no bookmaker lists players yet), then each match's goalscorer odds once more
 * within 6 h of its kickoff. Missing assists are asked for again every 6 h (an empty answer costs
 * nothing); matches fetched before assists were part of the set get them once.
 */
export function scorersToFetch(events: OddsEvent[], have: Record<string, ScorerMatch>, now: Date): ScorerFetch[] {
  const t = now.getTime();
  const upcoming = events.filter((e) => e.id && Date.parse(e.kickoff) > t).sort((a, b) => a.kickoff.localeCompare(b.kickoff));
  if (!upcoming.length) return [];
  const first = Date.parse(upcoming[0].kickoff);
  if (t < matchdayRelease(new Date(first)).getTime()) return [];
  const out: ScorerFetch[] = [];
  for (const e of upcoming) {
    const kickoff = Date.parse(e.kickoff);
    if (kickoff - first > MATCHDAY_HOURS * HOUR) continue;
    const got = have[e.id!];
    const last = got ? Date.parse(got.fetchedAt) : 0;
    if (!got?.fullAt) { out.push({ id: e.id!, kind: "full" }); continue; }
    if (!got.players.length) {
      if (t - last >= RETRY_HOURS * HOUR) out.push({ id: e.id!, kind: "full" });
      continue;
    }
    // The late refresh: once the match is within 6 h and the last fetch was before that.
    if (kickoff - t <= REFRESH_HOURS * HOUR && last < kickoff - REFRESH_HOURS * HOUR) out.push({ id: e.id!, kind: "goals" });
    const assistsDue = !got.assists || (!got.assists.length && t - Date.parse(got.assistsAt ?? got.fullAt) >= RETRY_HOURS * HOUR);
    if (assistsDue) out.push({ id: e.id!, kind: "assists" });
  }
  return out;
}

/** Drops matches that kicked off more than a day ago. */
export function pruneScorers(all: Record<string, ScorerMatch>, now: Date): Record<string, ScorerMatch> {
  return Object.fromEntries(Object.entries(all).filter(([, m]) => Date.parse(m.kickoff) > now.getTime() - 24 * HOUR));
}

/** True if the percentages shown on the site would not change. */
export function sameScorers(a: Record<string, ScorerMatch> | undefined, b: Record<string, ScorerMatch>): boolean {
  const pct = (list: ScorerPlayer[] | undefined) => (list ?? []).map((p) => [p.name, Math.round(p.p * 100)]).sort();
  const key = (all: Record<string, ScorerMatch>) =>
    JSON.stringify(Object.entries(all).map(([id, m]) => [
      id, pct(m.players), pct(m.assists), pct(m.cards),
      Object.entries(m.cleanSheet ?? {}).map(([t, p]) => [t, Math.round(p * 100)]).sort(),
    ]).sort());
  return !!a && key(a) === key(b);
}
