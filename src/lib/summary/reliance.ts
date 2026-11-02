import type { HistGame, KbHistory } from "../../../scraper/kbHistory.ts";
import { groupOf, type Group } from "./groups.ts";
import { RECENCY } from "./teamForm.ts";

/** What a player's points can depend on, and what this week's odds say about it: goals, clean sheet, win. */
export type Reliance = "goals" | "cleansheet" | "team";
const RELIANCES: Reliance[] = ["goals", "cleansheet", "team"];
/** Even above his position's line, a share this small isn't a dependency. */
const MIN_SHARE: Record<Reliance, number> = { goals: 0.15, cleansheet: 0.06, team: 0.15 };
const MIN_PLAYERS = 10;
const MIN_GAMES = 4;

/** Each group's share of his positive points, the newest game weighing most (each older one 15 % less). */
export function sharesOf(games: HistGame[]): Partial<Record<Group, number>> {
  const byGroup: Partial<Record<Group, number>> = {};
  let total = 0;
  [...games].filter((g) => g.minutes > 0).sort((a, b) => b.day - a.day).forEach((g, k) => {
    const w = RECENCY ** k;
    for (const [eti, points] of Object.entries(g.events ?? {})) {
      if (points <= 0) continue;
      const group = groupOf(eti);
      byGroup[group] = (byGroup[group] ?? 0) + points * w;
      total += points * w;
    }
  });
  return Object.fromEntries(Object.entries(byGroup).map(([g, v]) => [g, total ? v / total : 0]));
}

/** Per Kickbase position: the share of each source that 80 % of its players (with 4+ games) stay at or below. */
export function relianceNorms(history: KbHistory): Map<number, Record<Reliance, number>> {
  const byPosition = new Map<number, Partial<Record<Group, number>>[]>();
  for (const p of Object.values(history.players)) {
    if (p.games.filter((g) => g.minutes > 0).length < MIN_GAMES) continue;
    byPosition.set(p.position, [...(byPosition.get(p.position) ?? []), sharesOf(p.games)]);
  }
  const norms = new Map<number, Record<Reliance, number>>();
  for (const [position, list] of byPosition) {
    if (list.length < MIN_PLAYERS) continue;
    const line = (r: Reliance) => list.map((s) => s[r] ?? 0).sort((a, b) => a - b)[Math.floor(list.length * 0.8)];
    norms.set(position, Object.fromEntries(RELIANCES.map((r) => [r, line(r)])) as Record<Reliance, number>);
  }
  return norms;
}

/** The source he depends on clearly more than others in his position (furthest above their line), if any. */
export function relianceOf(shares: Partial<Record<Group, number>>, position: number, norms: Map<number, Record<Reliance, number>>): { kind: Reliance; share: number } | undefined {
  const norm = norms.get(position);
  if (!norm) return undefined;
  return RELIANCES
    .map((kind) => ({ kind, share: shares[kind] ?? 0 }))
    .filter(({ kind, share }) => share > norm[kind] && share >= MIN_SHARE[kind])
    .sort((a, b) => b.share / Math.max(norm[b.kind], 0.01) - a.share / Math.max(norm[a.kind], 0.01))[0];
}
