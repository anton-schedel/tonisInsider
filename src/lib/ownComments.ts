/**
 * Comments on our own posts (content/posts/), stored in D1. Anyone can comment under a name of their choice,
 * no login. LigaInsider's articles keep LigaInsider's comments (lib/comments.ts).
 */
import { grown, type PollView } from "./ownVotes.ts";

export type OwnComment = {
  id: number; user: string; date: string; text: string; replies: OwnComment[];
  /** Upvotes: real ones plus the bot votes grown so far. */
  score: number;
  /** This visitor upvoted it. */
  voted: boolean;
  poll?: PollView;
};
export type Row = {
  id: number; parent_id: number | null; name: string; body: string; created_at: string;
  bot_upvotes?: number; real_upvotes?: number; voted?: number;
};

/** The visitor's random id for votes (no login), kept for 400 days. */
export const VOTER_COOKIE = "ov";

/** Ids of our own posts start here (LigaInsider's are far below). */
export const OWN_POST_MIN_ID = 900_000_000;
export const isOwnPost = (id: number) => Number.isInteger(id) && id >= OWN_POST_MIN_ID && id < 1_000_000_000;

export const NAME_MAX = 30;
export const TEXT_MAX = 1000;
/** Per sender: at most this many comments within the window. */
export const RATE = { count: 5, windowMs: 10 * 60_000 };

/** Trims, drops control characters and collapses runs of blank lines. */
function clean(s: string, max: number): string {
  return s
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
}

export type NewComment = { name: string; text: string; parent?: number };

/** A valid new comment, or the reason it isn't (shown to the user as is). */
export function parseNewComment(raw: unknown): NewComment | { error: string } {
  if (!raw || typeof raw !== "object") return { error: "Ungültige Anfrage." };
  const r = raw as { name?: unknown; text?: unknown; parent?: unknown };
  const name = clean(String(r.name ?? "").replace(/\s+/g, " "), NAME_MAX);
  const text = clean(String(r.text ?? ""), TEXT_MAX);
  if (name.length < 2) return { error: "Gib einen Namen ein." };
  if (!text) return { error: "Schreib etwas." };
  const parent = r.parent === undefined || r.parent === null ? undefined : Number(r.parent);
  if (parent !== undefined && !(Number.isInteger(parent) && parent > 0)) return { error: "Ungültige Anfrage." };
  return { name, text, ...(parent ? { parent } : {}) };
}

/** Rows (oldest first) as threads: newest thread first, its replies in the order they came. */
export function toThreads(rows: Row[], polls: Map<number, PollView> = new Map(), now = new Date()): OwnComment[] {
  const byId = new Map<number, OwnComment>();
  const top: OwnComment[] = [];
  for (const r of rows) {
    const poll = polls.get(r.id);
    const c: OwnComment = {
      id: r.id, user: r.name, date: r.created_at, text: r.body, replies: [],
      score: grown(r.bot_upvotes ?? 0, r.created_at, now) + (r.real_upvotes ?? 0),
      voted: !!r.voted,
      ...(poll ? { poll } : {}),
    };
    byId.set(r.id, c);
    const parent = r.parent_id ? byId.get(r.parent_id) : undefined;
    if (parent) parent.replies.push(c);
    else top.push(c);
  }
  return top.reverse();
}

/** Hex SHA-256 of the sender's IP with a secret, so the table never holds an IP. */
export async function senderKey(ip: string, secret: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${secret}:${ip}`));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
