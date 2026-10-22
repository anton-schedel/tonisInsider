import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { isSameOrigin } from "../../../lib/session.ts";
import { validate } from "../../../lib/coachPosts.ts";
import { listPosts, savePost } from "../../../lib/coachDb.ts";
import { coachSignedIn, json, NOT_SIGNED_IN } from "../../../lib/coachApi.ts";

export const prerender = false;

/** GET /api/coach/posts/: the coach's posts, newest first. */
export const GET: APIRoute = async ({ cookies }) => {
  const db = env.COMMENTS;
  if (!db) return json({ error: "Gerade nicht erreichbar." }, 503);
  if (!(await coachSignedIn(cookies))) return json(NOT_SIGNED_IN, 401);
  return json({ posts: await listPosts(db) });
};

/** POST /api/coach/posts/ {type, data, publishedAt, pinnedHours, imageId?}: a new post. */
export const POST: APIRoute = async ({ request, cookies }) => {
  if (!isSameOrigin(request)) return json({ error: "Nicht erlaubt." }, 403);
  const db = env.COMMENTS;
  if (!db) return json({ error: "Gerade nicht erreichbar." }, 503);
  if (!(await coachSignedIn(cookies))) return json(NOT_SIGNED_IN, 401);
  let raw: unknown;
  try { raw = await request.json(); } catch { return json({ error: "Ungültige Anfrage." }, 400); }
  const input = validate(raw, new Date());
  if ("error" in input) return json(input, 400);
  const post = await savePost(db, input, new Date());
  return post ? json({ post }) : json({ error: "Konnte nicht gespeichert werden." }, 500);
};
