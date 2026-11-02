import type { HistMatch, HistPlayer } from "../../../scraper/kbHistory.ts";
import { groupOf, type Group } from "./groups.ts";
import { formBefore, RECENCY, venuePpg, weighted, type Form } from "./teamForm.ts";

export const MIN_GAMES = 4;
/** The opponent's points per game at its venue then: from 1.7 strong, up to 1.0 weak. */
export const STRONG_PPG = 1.7;
export const WEAK_PPG = 1.0;

/** The kind of match: at home or away, against a strong, middling or weak opponent (as it was then). */
export type Context = { home: boolean; opponent: "strong" | "middle" | "weak" };

export type Profile = {
  games: number;
  /** Points per game, weighted by recency. */
  avg: number;
  /** Which share of his (positive) points each group brings, weighted by recency. */
  shares: Partial<Record<Group, number>>;
  /** The biggest share, leaving out playing time and team success (they say nothing about his game). */
  top: Group;
  byContext: { context: Context; avg: number; games: number }[];
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
      const opponent = home ? m.away : m.home;
      return { g, date: m.date, context: { home, opponent: contextOf(formBefore(matches, opponent, m.date), !home) } };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
  if (games.length < MIN_GAMES) return undefined;

  const byGroup: Partial<Record<Group, number>> = {};
  let total = 0;
  games.forEach(({ g }, k) => {
    const w = RECENCY ** k;
    for (const [eti, points] of Object.entries(g.events ?? {})) {
      if (points <= 0) continue;
      const group = groupOf(eti);
      byGroup[group] = (byGroup[group] ?? 0) + points * w;
      total += points * w;
    }
  });
  const shares = Object.fromEntries(Object.entries(byGroup).map(([group, v]) => [group, total ? v / total : 0])) as Partial<Record<Group, number>>;
  const top = (Object.entries(shares) as [Group, number][])
    .filter(([group]) => group !== "time" && group !== "team")
    .sort((a, b) => b[1] - a[1])[0]?.[0] ?? "other";

  const buckets = new Map<string, { context: Context; points: number[] }>();
  for (const { g, context } of games) {
    const key = `${context.home}-${context.opponent}`;
    if (!buckets.has(key)) buckets.set(key, { context, points: [] });
    buckets.get(key)!.points.push(g.points);
  }
  return {
    games: games.length,
    avg: weighted(games.map(({ g }) => g.points))!,
    shares,
    top,
    byContext: [...buckets.values()].map((b) => ({ context: b.context, avg: weighted(b.points)!, games: b.points.length })),
  };
}

/** How he does in this kind of match against his average (0.5: half as many points); undefined from fewer than 2 such games. */
export function matchupIndex(profile: Profile, upcoming: Context): { index: number; games: number } | undefined {
  const b = profile.byContext.find((x) => x.context.home === upcoming.home && x.context.opponent === upcoming.opponent);
  if (!b || b.games < 2 || profile.avg <= 0) return undefined;
  return { index: b.avg / profile.avg, games: b.games };
}
