import type { KbLive } from "./kickbase.ts";

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
