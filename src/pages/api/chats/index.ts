import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { accountOf } from "../../../lib/chatsServer.ts";
import { listChats } from "../../../lib/chatsDb.ts";
import { chatView } from "../../../lib/chatsApi.ts";
import { loadAppFeed } from "../../../lib/snapshotServer.ts";
import { json } from "../../../lib/http.ts";

export const prerender = false;

/** GET /api/chats/: "Deine Chats" as last known (one database read; each row is refreshed on its own). */
export const GET: APIRoute = async ({ cookies, url }) => {
  const account = await accountOf(cookies);
  const db = env.COMMENTS;
  if (!account || !db) return json({ signedIn: !!account, chats: [] });
  const [rows, feed] = await Promise.all([listChats(db, account), loadAppFeed(url)]);
  return json({ signedIn: true, chats: rows.map((r) => chatView(r, feed)) });
};
