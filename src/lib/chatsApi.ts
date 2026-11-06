import type { AppFeed } from "./appFeed.ts";
import { chatLines, chatNews, conversationState, type ChatKind, type ChatNews, type ChatState, type ChatStatus, type ConvComment } from "./chats.ts";
import type { ChatPlace, ChatRow } from "./chatsDb.ts";
import { threadKey, type Comments, type MoreCursor } from "./comments.ts";
import { isOwnPost } from "./ownComments.ts";

/** One row of "Deine Chats", as the website and the app get it (/api/chats/). */
export type ChatView = {
  id: number;
  place: ChatPlace;
  /** Into the article (or the lineup page), to the conversation. */
  link: string;
  started: boolean;
  kind: ChatKind;
  /** Your last write or the newest answer, as last known. */
  activityAt: string;
  status: ChatStatus;
  /** Only while status is ok: what changed since you last looked. */
  news?: ChatNews;
  lines: { mine: string; status: string };
  /** Read at least once (the status line is there). */
  checked: boolean;
};

function statusOf(row: ChatRow, feed: AppFeed | undefined): ChatStatus {
  if (row.state?.gone) return "gone";
  if (!feed) return "ok";
  if (/^\d+$/.test(row.thread)) return feed.articles.some((a) => a.id === Number(row.thread)) ? "ok" : "gone";
  return feed.lineups.some((l) => l.comments && threadKey(l.comments) === row.thread) ? "ok" : "over";
}

export function chatView(row: ChatRow, feed: AppFeed | undefined): ChatView {
  const status = statusOf(row, feed);
  const news = status === "ok" ? chatNews(row.state, row.seen) : undefined;
  return {
    id: row.id,
    place: row.place,
    link: `${row.place.href}#c${row.root}`,
    started: row.started,
    kind: row.kind,
    activityAt: row.activityAt,
    status,
    ...(news ? { news } : {}),
    lines: chatLines({ kind: row.kind, text: row.text, started: row.started, state: row.state, news, status }),
    checked: !!row.state,
  };
}

/** How a refresh reads a thread: LigaInsider's (a batch, the next one from a cursor) or one of our own posts. */
export type ThreadReaders = {
  liga(thread: string, cursor?: MoreCursor): Promise<Comments>;
  own(postId: number): Promise<{ comments: ConvComment[] }>;
};

const EMPTY: ChatState = { mine: {}, answers: 0, others: [] };

/** Batches of a LigaInsider thread looked through for a conversation (the first page and the ones after it). */
export const MAX_BATCHES = 12;

/** A read: where it stands, and where it stood when you last wrote (what you'd seen, if nothing newer is stored). */
export type Refreshed = { state: ChatState; baseline: ChatState };

/**
 * Where the conversation stands now. LigaInsider gives a long thread in batches: while the top comment isn't
 * in this one, the answer is the next batch's cursor (one batch per Worker call: the free plan's CPU limit).
 * Gone only after the thread's end; on the `last` batch looked through, the last known state, marked deep.
 */
export async function refreshState(row: ChatRow, read: ThreadReaders, cursor?: MoreCursor, last = false): Promise<Refreshed | { next: MoreCursor }> {
  const kept = (mark: { gone: true } | { deep: true }) => { const state = { ...(row.state ?? EMPTY), ...mark }; return { state, baseline: state }; };
  const id = Number(row.thread);
  const found = (list: ConvComment[]): Refreshed | undefined => {
    const root = list.find((c) => c.id === row.root);
    return root && {
      state: conversationState(root, row.mine, row.started),
      baseline: conversationState(root, row.mine, row.started, { at: row.wroteAt, fresh: row.mine.at(-1) }),
    };
  };
  if (isOwnPost(id)) return found((await read.own(id)).comments) ?? kept({ gone: true });
  const page = await read.liga(row.thread, cursor);
  const hit = found(page.comments);
  if (hit) return hit;
  if (page.more && page.comments.length && page.more.cursor !== cursor?.cursor) return last ? kept({ deep: true }) : { next: page.more };
  return kept({ gone: true });
}

/** Read under a minute ago (one too deep in its thread: 15 minutes): no new read from LigaInsider. */
export const fresh = (checkedAt: string | undefined, now: Date, deep = false) =>
  !!checkedAt && now.getTime() - Date.parse(checkedAt) < (deep ? 15 : 1) * 60_000;
