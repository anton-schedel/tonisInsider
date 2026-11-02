import type { HistMatch } from "../../../scraper/kbHistory.ts";

/** Each game counts 15 % less than the next newer one: the 5th-last still about half (only this season counts). */
export const RECENCY = 0.85;

/**
 * A team's strength as it was before a match: points per game weighted by recency (overall, at home, away) and
 * momentum, the plain points of its last `last` (≤ 5) games.
 */
export type Form = { games: number; ppg: number; homePpg?: number; awayPpg?: number; momentum: number; last: number };

/** The recency-weighted average of values given newest first. */
export function weighted(newestFirst: number[]): number | undefined {
  if (!newestFirst.length) return undefined;
  let sum = 0;
  let total = 0;
  newestFirst.forEach((v, k) => { const w = RECENCY ** k; sum += v * w; total += w; });
  return sum / total;
}

const pointsOf = (m: HistMatch, teamId: string): number => {
  const own = m.home === teamId ? m.homeGoals! : m.awayGoals!;
  const other = m.home === teamId ? m.awayGoals! : m.homeGoals!;
  return own > other ? 3 : own === other ? 1 : 0;
};

export function formBefore(matches: Record<string, HistMatch>, teamId: string, before: string): Form | undefined {
  const played = Object.values(matches)
    .filter((m) => (m.home === teamId || m.away === teamId) && m.homeGoals !== undefined && m.awayGoals !== undefined && m.date < before)
    .sort((a, b) => b.date.localeCompare(a.date));
  if (!played.length) return undefined;
  const points = (list: HistMatch[]) => list.map((m) => pointsOf(m, teamId));
  const recent = points(played.slice(0, 5));
  return {
    games: played.length,
    ppg: weighted(points(played))!,
    homePpg: weighted(points(played.filter((m) => m.home === teamId))),
    awayPpg: weighted(points(played.filter((m) => m.away === teamId))),
    momentum: recent.reduce((a, b) => a + b, 0),
    last: recent.length,
  };
}

/** How strong the team is at this venue (home or away), else overall. */
export const venuePpg = (f: Form, home: boolean): number => (home ? f.homePpg : f.awayPpg) ?? f.ppg;
