import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { accountOf } from "../../../lib/chatsServer.ts";
import { getChat, saveState } from "../../../lib/chatsDb.ts";
import { chatView, fresh, MAX_BATCHES, refreshState, type ThreadReaders } from "../../../lib/chatsApi.ts";
import { cursorFrom, fetchComments, fetchMoreComments, parseThreadKey } from "../../../lib/comments.ts";
import { loadThreads } from "../../../lib/ownCommentsDb.ts";
import { loadAppFeed } from "../../../lib/snapshotServer.ts";
import { json } from "../../../lib/http.ts";

export const prerender = false;

/**
 * GET /api/chats/<id>/[?offset=…&goffset=…&moffset=…&cursor=…&n=…]: one chat read fresh → {chat}, or {next} when
 * the conversation is further down LigaInsider's thread (ask again with that cursor and the batch number n). Read
 * under a minute ago: the stored row, no request to LigaInsider.
 */
export const GET: APIRoute = async ({ params, cookies, url }) => {
  const account = await accountOf(cookies);
  const db = env.COMMENTS;
  const id = Number(params.id);
  if (!account || !db || !Number.isInteger(id)) return json({ error: "Nicht gefunden." }, 404);
  const row = await getChat(db, account, id);
  if (!row) return json({ error: "Nicht gefunden." }, 404);
  const now = new Date();
  const cursor = cursorFrom(url.searchParams);
  if (!cursor && fresh(row.checkedAt, now, row.state?.deep)) return json({ chat: chatView(row, await loadAppFeed(url)) });
  const last = (Number(url.searchParams.get("n")) || 0) >= MAX_BATCHES - 1;

  // LigaInsider without the reader's login: votes, answers and poll results are the same for everyone.
  const read: ThreadReaders = {
    liga: (key, from) => {
      const thread = parseThreadKey(key);
      if (thread === undefined) throw new Error("bad thread key");
      return from ? fetchMoreComments(fetch, thread, from) : fetchComments(fetch, thread);
    },
    own: (postId) => loadThreads(db, postId, "", now),
  };
  try {
    const result = await refreshState(row, read, cursor, last);
    if ("next" in result) return json({ next: result.next });
    await saveState(db, account, id, result.state, now, result.baseline);
    const saved = await getChat(db, account, id);
    return json({ chat: chatView(saved ?? row, await loadAppFeed(url)) });
  } catch (err) {
    console.warn(`chats: refresh failed: ${err instanceof Error ? err.constructor.name : "unknown"}`);
    return json({ error: "LigaInsider ist gerade nicht erreichbar." }, 502);
  }
};
