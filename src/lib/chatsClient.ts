/** "Deine Chats" in the browser: the list, a fresh read per chat, "seen", and when to look again (the bubble). */
import type { ChatView } from "./chatsApi.ts";
import type { MoreCursor } from "./comments.ts";

export type ChatsAnswer = { signedIn: boolean; chats: ChatView[] };

/** The bubble looks for news at most this often (each look reads every chat's thread). */
export const CHECK_EVERY_MS = 3 * 60_000;
/** A conversation further down LigaInsider's thread than this many batches isn't looked for. */
const MAX_BATCHES = 8;

export const badgeCount = (chats: ChatView[]) => chats.filter((c) => c.news && c.status === "ok").length;
export const dueCheck = (last: number | undefined, now: number) => last === undefined || now - last >= CHECK_EVERY_MS;

export async function loadChats(): Promise<ChatsAnswer> {
  const res = await fetch("/api/chats/");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as ChatsAnswer;
}

/** One chat read fresh, following the thread's batches; undefined when it can't be read right now. */
export async function refreshChat(id: number): Promise<ChatView | undefined> {
  let cursor: MoreCursor | undefined;
  for (let i = 0; i < MAX_BATCHES; i++) {
    const q = cursor ? `?${new URLSearchParams({ offset: String(cursor.offset), goffset: String(cursor.goffset), moffset: String(cursor.moffset), cursor: String(cursor.cursor) })}` : "";
    try {
      const res = await fetch(`/api/chats/${id}/${q}`);
      if (!res.ok) return undefined;
      const data = (await res.json()) as { chat?: ChatView; next?: MoreCursor };
      if (data.chat) return data.chat;
      if (!data.next) return undefined;
      cursor = data.next;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/** Every chat read fresh, a few at a time; `each` gets each one as it arrives. */
export async function refreshAll(chats: ChatView[], each: (c: ChatView) => void, parallel = 3): Promise<void> {
  const queue = [...chats];
  await Promise.all(Array.from({ length: Math.min(parallel, queue.length) }, async () => {
    for (let c = queue.shift(); c; c = queue.shift()) {
      const fresh = await refreshChat(c.id);
      if (fresh) each(fresh);
    }
  }));
}

/** You opened it. Sent so it arrives even while the page changes. */
export function markSeen(id: number): void {
  void fetch(`/api/chats/${id}/seen/`, { method: "POST", keepalive: true }).catch(() => {});
}

// The bubble's last number and look, kept while the tab is open (it survives page changes, not the session).
const COUNT_KEY = "chatsBadge";
const AT_KEY = "chatsCheckedAt";
const read = (k: string) => { try { return sessionStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string) => { try { sessionStorage.setItem(k, v); } catch {} };
export const savedBadge = () => Number(read(COUNT_KEY)) || 0;
export const saveBadge = (n: number) => write(COUNT_KEY, String(n));
export const lastCheck = () => Number(read(AT_KEY)) || undefined;
export const checkedNow = () => write(AT_KEY, String(Date.now()));
