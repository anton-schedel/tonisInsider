/**
 * Upvotes and polls under our own posts, LigaInsider-style. Bot votes (on bot comments, and on visitors' comments
 * and polls too, so real and bot can't be told apart) don't show all at once: they grow over the first 30 minutes
 * after the comment appears. The Worker works the visible numbers out on each request.
 */

export const GROW_MS = 30 * 60_000;

/** The part of `full` bot votes visible at `now`: 0 when the comment appears, all of them 30 minutes later. */
export function grown(full: number, createdAt: string, now: Date): number {
  const t = Math.min(1, Math.max(0, (now.getTime() - Date.parse(createdAt)) / GROW_MS));
  if (t >= 1) return full;
  // Ease-out: most votes come early, like on a fresh post.
  return Math.floor(full * (1 - (1 - t) ** 2));
}

/** A comment's bot upvotes: none for some, a few for most, many for the odd hit. */
export function botUpvotes(random: () => number = Math.random): number {
  const r = random();
  if (r < 0.15) return 0;
  if (r < 0.9) return 1 + Math.floor(((r - 0.15) / 0.75) * 8);
  return 15 + Math.floor(((r - 0.9) / 0.1) * 26);
}

/** Bot votes per answer of a poll: 6 to 30 in all, spread unevenly. */
export function botPollVotes(options: number, random: () => number = Math.random): number[] {
  const total = 6 + Math.floor(random() * 25);
  const weights = Array.from({ length: options }, () => random() ** 1.5 + 0.05);
  const sum = weights.reduce((a, b) => a + b, 0);
  const votes = weights.map((w) => Math.floor((w / sum) * total));
  votes[0] += total - votes.reduce((a, b) => a + b, 0);
  return votes;
}

/** Whole percentages that add up to 100 (the largest remainders get the leftover points); all 0 without votes. */
export function wholePercents(counts: number[]): number[] {
  const total = counts.reduce((a, b) => a + b, 0);
  if (!total) return counts.map(() => 0);
  const exact = counts.map((n) => (n / total) * 100);
  const pct = exact.map((x) => Math.floor(x));
  const order = exact.map((_, i) => i).sort((i, j) => (exact[j] - pct[j]) - (exact[i] - pct[i]));
  const left = 100 - pct.reduce((a, b) => a + b, 0);
  for (let k = 0; k < left; k++) pct[order[k]]++;
  return pct;
}

export type PollOptionView = { id: number; label: string; pct: number };
export type PollView = { question: string; total: number; options: PollOptionView[]; mine?: number };

export function pollView(
  question: string,
  options: { id: number; label: string; bot: number; real: number }[],
  createdAt: string,
  now: Date,
  mine?: number,
): PollView {
  const counts = options.map((o) => grown(o.bot, createdAt, now) + o.real);
  const pct = wholePercents(counts);
  return {
    question,
    total: counts.reduce((a, b) => a + b, 0),
    options: options.map((o, i) => ({ id: o.id, label: o.label, pct: pct[i] })),
    ...(mine !== undefined ? { mine } : {}),
  };
}

export const QUESTION_MAX = 200;
export const ANSWER_MAX = 80;
export const ANSWERS_MAX = 6;

export type NewPoll = { question: string; options: string[] };

/** A visitor's poll, checked and trimmed, or the reason it isn't valid (shown as is). */
export function parseNewPoll(raw: unknown): NewPoll | { error: string } {
  if (!raw || typeof raw !== "object") return { error: "Ungültige Anfrage." };
  const r = raw as { question?: unknown; options?: unknown };
  const question = String(r.question ?? "").replace(/\s+/g, " ").trim().slice(0, QUESTION_MAX);
  if (question.length < 3) return { error: "Schreib eine Frage." };
  const options = (Array.isArray(r.options) ? r.options : [])
    .map((o) => String(o ?? "").replace(/\s+/g, " ").trim().slice(0, ANSWER_MAX))
    .filter(Boolean)
    .slice(0, ANSWERS_MAX);
  if (options.length < 2) return { error: "Mindestens zwei Antworten." };
  return { question, options };
}
