import type { NewsType } from "../../scraper/types.ts";
import type { BotMood, CoachInput, CoachThumb, CoachType } from "./coachPosts.ts";
import { kickoffDay, time } from "./format.ts";

/** The editor's fields as typed (coachClient reads them from the form). */
export type FormValues = {
  type: CoachType;
  lines: string[];
  bench: string;
  opponent: string;
  ours: string;
  theirs: string;
  home: boolean;
  playerName: string;
  badge: NewsType;
  headline: string;
  text: string;
  when: "now" | "later";
  /** datetime-local value, the coach's local time. */
  at: string;
  pin: string;
  bots: boolean;
  context: string;
  mood: BotMood;
};

export const namesOf = (s: string) => s.split(",").map((n) => n.trim()).filter(Boolean);

/** The body for POST/PUT /api/coach/posts/ (the server checks it again). */
export function toBody(v: FormValues, now: Date, imageId?: string, thumb?: CoachThumb): Omit<CoachInput, "imageId"> & { imageId?: string } {
  const text = v.text.trim();
  const context = v.context.trim();
  const data: CoachInput["data"] = { headline: v.headline.trim(), ...(text ? { text } : {}) };
  if (v.type === "lineup") data.lineup = { lines: v.lines.map(namesOf).filter((l) => l.length), bench: namesOf(v.bench) };
  if (v.type === "result") data.result = { opponent: v.opponent.trim(), ours: Number(v.ours), theirs: Number(v.theirs), home: v.home };
  if (v.type === "player") data.player = { name: v.playerName.trim(), newsType: v.badge };
  if (v.type === "player" && thumb) data.thumb = thumb;
  data.bots = { on: v.bots, ...(context ? { context } : {}), ...(v.mood !== "gemischt" ? { mood: v.mood } : {}) };
  const at = v.when === "now" || !v.at ? now : new Date(v.at);
  return {
    type: v.type, data,
    publishedAt: Number.isNaN(at.getTime()) ? "" : at.toISOString(),
    pinnedHours: Number(v.pin) || 0,
    ...(imageId ? { imageId } : {}),
  };
}

export function statusOf(publishedAt: string, now: Date): { planned: boolean; label: string } {
  const when = `${kickoffDay(publishedAt)}, ${time(publishedAt)}`;
  return Date.parse(publishedAt) > now.getTime() ? { planned: true, label: `Geplant: ${when}` } : { planned: false, label: `Online seit ${when}` };
}

/** An ISO time as a datetime-local value (the browser's time zone). */
export function localInput(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
