import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { accountOf } from "../../../lib/chatsServer.ts";
import { markAllSeen } from "../../../lib/chatsDb.ts";
import { isSameOrigin } from "../../../lib/session.ts";
import { json, notAllowed } from "../../../lib/http.ts";

export const prerender = false;

/** POST /api/chats/seen/: "Alle gelesen" — every chat as it stands now counts as seen. */
export const POST: APIRoute = async ({ request, cookies }) => {
  if (!isSameOrigin(request)) return notAllowed();
  const account = await accountOf(cookies);
  const db = env.COMMENTS;
  if (!account || !db) return json({ error: "Nicht gefunden." }, 404);
  await markAllSeen(db, account);
  return json({ ok: true });
};
