import type { HistMatch, HistPlayer } from "../../../scraper/kbHistory.ts";
import type { Group } from "./groups.ts";
import { sharesOf } from "./reliance.ts";
import { formBefore, venuePpg, weighted, type Form } from "./teamForm.ts";

export const MIN_GAMES = 4;
/** The opponent's points per game at its venue then: from 1.7 strong, up to 1.0 weak. */
export const STRONG_PPG = 1.7;
export const WEAK_PPG = 1.0;
/** An opponent's form says something from its 3rd game on; before that a match isn't put into any kind. */
export const MIN_FORM_GAMES = 3;

/** The kind of match: at home or away, against a strong, middling or weak opponent (as it was then). */
export type Context = { home: boolean; opponent: "strong" | "middle" | "weak" };

export type Profile = {
  games: number;
  /** Points per game, weighted by recency. */
  avg: number;
  /** Which share of his (positive) points each group brings, weighted by recency. */
  shares: Partial<Record<Group, number>>;
  /** The biggest share, leaving out playing time, team success and the ungrouped rest (they say nothing about his game). */
  top: Group;
  byContext: { context: Context; avg: number; games: number }[];
  /** At home and away (every game with minutes, whatever the opponent), weighted by recency. */
  byVenue: { home?: { avg: number; games: number }; away?: { avg: number; games: number } };
};

export function contextOf(form: Form | undefined, opponentHome: boolean): Context["opponent"] {
  if (!form) return "middle";
  const ppg = venuePpg(form, opponentHome);
  return ppg >= STRONG_PPG ? "strong" : ppg <= WEAK_PPG ? "weak" : "middle";
}

export function profileOf(p: HistPlayer, matches: Record<string, HistMatch>): Profile | undefined {
  const games = p.games
    .filter((g) => g.minutes > 0 && matches[g.matchId])
    .map((g) => {
      const m = matches[g.matchId];
      const team = g.team ?? p.team;
      const home = m.home === team;
      const form = formBefore(matches, home ? m.away : m.home, m.date);
      const context = form && form.games >= MIN_FORM_GAMES ? { home, opponent: contextOf(form, !home) } : undefined;
      return { g, date: m.date, home, context };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
  if (games.length < MIN_GAMES) return undefined;

  const shares = sharesOf(games.map(({ g }) => g));
  const top = (Object.entries(shares) as [Group, number][])
    .filter(([group]) => group !== "time" && group !== "team" && group !== "other")
    .sort((a, b) => b[1] - a[1])[0]?.[0] ?? "other";

  const buckets = new Map<string, { context: Context; points: number[] }>();
  for (const { g, context } of games) {
    if (!context) continue;
    const key = `${context.home}-${context.opponent}`;
    if (!buckets.has(key)) buckets.set(key, { context, points: [] });
    buckets.get(key)!.points.push(g.points);
  }
  const venue = (home: boolean) => {
    const points = games.filter((x) => x.home === home).map(({ g }) => g.points);
    return points.length ? { avg: weighted(points)!, games: points.length } : undefined;
  };
  return {
    byVenue: { home: venue(true), away: venue(false) },
    games: games.length,
    avg: weighted(games.map(({ g }) => g.points))!,
    shares,
    top,
    byContext: [...buckets.values()].map((b) => ({ context: b.context, avg: weighted(b.points)!, games: b.points.length })),
  };
}

/** At least this many games of the kind; and the kind's average counts as if PRIOR more games had his average. */
export const MIN_KIND = 3;
const PRIOR = 3;

/**
 * How he does in this kind of match against his average (0.5: half as many points). Few games say little, so their
 * average is pulled toward his overall one: two lucky games alone never make a claim. Undefined from fewer than 3.
 */
export function matchupIndex(profile: Profile, upcoming: Context): { index: number; games: number } | undefined {
  const b = profile.byContext.find((x) => x.context.home === upcoming.home && x.context.opponent === upcoming.opponent);
  if (!b || b.games < MIN_KIND || profile.avg <= 0) return undefined;
  const shrunk = (b.games * b.avg + PRIOR * profile.avg) / (b.games + PRIOR);
  return { index: shrunk / profile.avg, games: b.games };
}

/**
 * His points at this venue against the other one (1.5: half again as many at home as away), both pulled toward his
 * average like the kinds of match. Undefined without three games on both sides.
 */
export function venueIndex(profile: Profile, home: boolean): { index: number; games: number } | undefined {
  const here = home ? profile.byVenue.home : profile.byVenue.away;
  const there = home ? profile.byVenue.away : profile.byVenue.home;
  if (!here || !there || here.games < MIN_KIND || there.games < MIN_KIND || profile.avg <= 0) return undefined;
  const shrink = (v: { avg: number; games: number }) => (v.games * v.avg + PRIOR * profile.avg) / (v.games + PRIOR);
  const other = shrink(there);
  return other > 0 ? { index: shrink(here) / other, games: here.games } : undefined;
}
