import type { KbEvent, KbLive } from "./kickbase.ts";
import { swapText } from "./swapText.ts";
import type { SlotPlay } from "./match.ts";

/**
 * The points of a club's lineup players (club pages), by LigaInsider id, and the state of its match.
 * ids: their Kickbase ids, for the breakdown in the player card.
 */
export type ClubPoints = {
  live: Omit<KbLive, "points">;
  players: Record<number, number>;
  ids: Record<number, string>;
  /** From kickoff on, per slot (LigaInsider id of the predicted starter): who started and who came on. */
  slots?: Record<number, SlotPlay>;
};

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
export type PointsLabel = { text: string; live: boolean; tier?: PointsTier };

/**
 * Colour steps for points (CSS classes .pts-*): red below 0, orange up to 99, light green 100–199, a darker
 * green 200–399, gold from 400. The shades are Kickbase's (measured from its app), gold for the rare big days.
 */
export type PointsTier = "pts-neg" | "pts-low" | "pts-mid" | "pts-high" | "pts-gold";
export const TIERS: PointsTier[] = ["pts-neg", "pts-low", "pts-mid", "pts-high", "pts-gold"];

export function pointsTier(points: number | undefined): PointsTier | undefined {
  if (points === undefined) return undefined;
  if (points < 0) return "pts-neg";
  if (points < 100) return "pts-low";
  if (points < 200) return "pts-mid";
  if (points < 400) return "pts-high";
  return "pts-gold";
}

/** A single action in the breakdown, like Kickbase's live list: minus red, plus light green, big ones darker green. */
export function actionTier(points: number): PointsTier {
  return points < 0 ? "pts-neg" : points >= 20 ? "pts-high" : "pts-mid";
}

/** Puts an element in its colour step (and out of the others). */
export function setTier(el: Element, tier: PointsTier | undefined) {
  el.classList.remove(...TIERS);
  if (tier) el.classList.add(tier);
}

export function pointsLabel(live: KbLive | undefined): PointsLabel | undefined {
  if (!live || live.state === 0) return undefined;
  // No points yet: 0 while the match runs, "–" once it's over (he didn't play).
  const text = live.points !== undefined ? String(live.points) : live.state === 1 ? "0" : "–";
  const tier = pointsTier(live.points);
  return { text, live: live.state === 1, ...(tier ? { tier } : {}) };
}

/** What a screen reader says for a points chip. */
export const pointsAria = (label: PointsLabel) => `${label.text} Kickbase-Punkte${label.live ? ", live" : ""}`;

/**
 * Fills a points chip (KbPoints.astro) with its label, or hides it when there is none. ease: the chip was
 * showing a number, so a change dips once (swapText); one that just appears is set.
 */
export function applyPoints(el: HTMLElement, label: PointsLabel | undefined, ease = false) {
  el.hidden = !label;
  if (!label) return;
  const text = el.querySelector("[data-kb-text]")!;
  if (ease) swapText(text, label.text);
  else text.textContent = label.text;
  el.classList.toggle("is-live", label.live);
  setTier(el, label.tier);
  el.setAttribute("aria-label", pointsAria(label));
}

/** The live updates (Mein Team) poll while a match of the XI or bench has started and isn't over. */
export function anyRunning(lives: (KbLive | undefined)[], now: number): boolean {
  return lives.some((l) => l && (l.state === 1 || (l.state === 0 && l.kickoff !== undefined && Date.parse(l.kickoff) <= now)));
}
