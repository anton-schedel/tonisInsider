import type { D1 } from "cloudflare:workers";
import type { ChatKind, ChatState } from "./chats.ts";

/** Where a conversation hangs, as its row shows it: the article (or lineup page) title, its link, its club. */
export type ChatPlace = { title: string; href: string; club?: { name: string; slug: string; crest?: string }; own?: boolean };
/** One write through TonInsider: a comment, an Umfrage or an answer in the conversation under `root`. */
export type ChatWrite = { thread: string; root: number; id: number; kind: ChatKind; text: string; place: ChatPlace };
export type ChatRow = {
  id: number;
  thread: string;
  root: number;
  mine: number[];
  started: boolean;
  kind: ChatKind;
  text: string;
  place: ChatPlace;
  wroteAt: string;
  activityAt: string;
  state?: ChatState;
  seen?: ChatState;
  checkedAt?: string;
};

/** Conversations kept per account; the list shows the ones you wrote in last. */
export const KEEP = 20;
export const SHOWN = 10;

type Raw = {
  id: number; thread: string; root: number; mine: string; started: number; kind: string; text: string; place: string;
  wrote_at: string; activity_at: string; state: string | null; seen: string | null; checked_at: string | null;
};

function toRow(r: Raw): ChatRow {
  return {
    id: r.id, thread: r.thread, root: r.root, mine: JSON.parse(r.mine) as number[], started: r.started === 1,
    kind: r.kind as ChatKind, text: r.text, place: JSON.parse(r.place) as ChatPlace, wroteAt: r.wrote_at, activityAt: r.activity_at,
    ...(r.state ? { state: JSON.parse(r.state) as ChatState } : {}),
    ...(r.seen ? { seen: JSON.parse(r.seen) as ChatState } : {}),
    ...(r.checked_at ? { checkedAt: r.checked_at } : {}),
  };
}

/**
 * Adds a write to its conversation (a new row the first time). Writing in it counts as having looked: what
 * you saw starts again from the next read. Older conversations beyond KEEP go.
 */
export async function recordWrite(db: D1, account: string, w: ChatWrite, now: Date): Promise<void> {
  const at = now.toISOString();
  const known = await db
    .prepare("SELECT mine FROM chats WHERE account = ? AND thread = ? AND root = ?")
    .bind(account, w.thread, w.root)
    .first<{ mine: string }>();
  if (known) {
    const mine = JSON.parse(known.mine) as number[];
    if (!mine.includes(w.id)) mine.push(w.id);
    await db
      .prepare(`UPDATE chats SET mine = ?, kind = ?, text = ?, place = ?, wrote_at = ?, activity_at = MAX(activity_at, ?), seen = NULL
        WHERE account = ? AND thread = ? AND root = ?`)
      .bind(JSON.stringify(mine), w.kind, w.text, JSON.stringify(w.place), at, at, account, w.thread, w.root)
      .run();
  } else {
    await db
      .prepare(`INSERT INTO chats (account, thread, root, mine, started, kind, text, place, wrote_at, activity_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(account, w.thread, w.root, JSON.stringify([w.id]), w.root === w.id ? 1 : 0, w.kind, w.text, JSON.stringify(w.place), at, at)
      .run();
  }
  await db
    .prepare(`DELETE FROM chats WHERE account = ? AND id NOT IN
      (SELECT id FROM chats WHERE account = ? ORDER BY wrote_at DESC, id DESC LIMIT ?)`)
    .bind(account, account, KEEP)
    .run();
}

/** The SHOWN conversations you wrote in last, the one with the newest activity first. */
export async function listChats(db: D1, account: string): Promise<ChatRow[]> {
  const { results } = await db
    .prepare(`SELECT * FROM (SELECT * FROM chats WHERE account = ? ORDER BY wrote_at DESC, id DESC LIMIT ?)
      ORDER BY activity_at DESC, id DESC`)
    .bind(account, SHOWN)
    .all<Raw>();
  return results.map(toRow);
}

export async function getChat(db: D1, account: string, id: number): Promise<ChatRow | undefined> {
  const r = await db.prepare("SELECT * FROM chats WHERE id = ? AND account = ?").bind(id, account).first<Raw>();
  return r ? toRow(r) : undefined;
}

/** A fresh read: stored with its time; the first one (or the first after you wrote) is what you've seen. */
export async function saveState(db: D1, account: string, id: number, state: ChatState, now: Date): Promise<void> {
  const json = JSON.stringify(state);
  await db
    .prepare(`UPDATE chats SET state = ?, checked_at = ?, activity_at = MAX(wrote_at, COALESCE(?, wrote_at)), seen = COALESCE(seen, ?)
      WHERE id = ? AND account = ?`)
    .bind(json, now.toISOString(), state.latest?.date ?? null, json, id, account)
    .run();
}

/** You looked: what's there now is what you've seen. */
export async function markSeen(db: D1, account: string, id: number): Promise<void> {
  await db.prepare("UPDATE chats SET seen = state WHERE id = ? AND account = ? AND state IS NOT NULL").bind(id, account).run();
}
