import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { accountOf } from "../../../../lib/chatsServer.ts";
import { markSeen } from "../../../../lib/chatsDb.ts";
import { isSameOrigin } from "../../../../lib/session.ts";
import { json, notAllowed } from "../../../../lib/http.ts";

export const prerender = false;

/** POST /api/chats/<id>/seen/: you opened the chat; what's there now is what you've seen. */
export const POST: APIRoute = async ({ params, request, cookies }) => {
  if (!isSameOrigin(request)) return notAllowed();
  const account = await accountOf(cookies);
  const db = env.COMMENTS;
  const id = Number(params.id);
  if (!account || !db || !Number.isInteger(id)) return json({ error: "Nicht gefunden." }, 404);
  await markSeen(db, account, id);
  return json({ ok: true });
};
