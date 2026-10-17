import type { KbEvent, KbLive } from "./kickbase.ts";

/**
 * The points of a club's lineup players (club pages), by LigaInsider id, and the state of its match.
 * ids: their Kickbase ids, for the breakdown in the player card.
 */
export type ClubPoints = { live: Omit<KbLive, "points">; players: Record<number, number>; ids: Record<number, string> };

/** One line of a player's points breakdown: an action, how often, and its points in total. */
export type PointsLine = { name: string; count: number; points: number };
/** What the player card shows from kickoff on. */
export type PlayerPoints = { live: KbLive; lines: PointsLine[] };

/** The actions behind a player's points, grouped by kind, biggest effect first. Actions worth nothing are left out. */
export function summarize(events: KbEvent[], names: Map<number, string>): PointsLine[] {
  const by = new Map<number, PointsLine>();
  for (const e of events) {
    if (!e.points) continue;
    const line = by.get(e.type) ?? { name: names.get(e.type) ?? "Sonstiges", count: 0, points: 0 };
    line.count++;
    line.points += e.points;
    by.set(e.type, line);
  }
  return [...by.values()].filter((l) => l.points !== 0).sort((a, b) => Math.abs(b.points) - Math.abs(a.points) || b.count - a.count);
}

/** Shown from kickoff on: the player's Kickbase points (live while his match runs). Nothing before kickoff. */
export type PointsLabel = { text: string; live: boolean; negative: boolean };

export function pointsLabel(live: KbLive | undefined): PointsLabel | undefined {
  if (!live || live.state === 0) return undefined;
  // No points yet: 0 while the match runs, "–" once it's over (he didn't play).
  const text = live.points !== undefined ? String(live.points) : live.state === 1 ? "0" : "–";
  return { text, live: live.state === 1, negative: (live.points ?? 0) < 0 };
}

/** The live updates (Mein Team) poll while a match of the XI or bench has started and isn't over. */
export function anyRunning(lives: (KbLive | undefined)[], now: number): boolean {
  return lives.some((l) => l && (l.state === 1 || (l.state === 0 && l.kickoff !== undefined && Date.parse(l.kickoff) <= now)));
}
