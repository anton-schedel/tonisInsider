import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { isSameOrigin } from "../../../../lib/session.ts";
import { validate } from "../../../../lib/coachPosts.ts";
import { deletePost, savePost } from "../../../../lib/coachDb.ts";
import { coachSignedIn, json, NOT_SIGNED_IN } from "../../../../lib/coachApi.ts";

export const prerender = false;

/** PUT /api/coach/posts/<id>/: replaces the post. */
export const PUT: APIRoute = async ({ request, cookies, params }) => {
  if (!isSameOrigin(request)) return json({ error: "Nicht erlaubt." }, 403);
  const db = env.COMMENTS;
  if (!db) return json({ error: "Gerade nicht erreichbar." }, 503);
  if (!(await coachSignedIn(cookies))) return json(NOT_SIGNED_IN, 401);
  let raw: unknown;
  try { raw = await request.json(); } catch { return json({ error: "Ungültige Anfrage." }, 400); }
  const input = validate(raw, new Date());
  if ("error" in input) return json(input, 400);
  const post = await savePost(db, input, new Date(), Number(params.id));
  return post ? json({ post }) : json({ error: "Den Beitrag gibt es nicht mehr." }, 404);
};

/** DELETE /api/coach/posts/<id>/: gone with the next build, its bot comments at once. */
export const DELETE: APIRoute = async ({ request, cookies, params }) => {
  if (!isSameOrigin(request)) return json({ error: "Nicht erlaubt." }, 403);
  const db = env.COMMENTS;
  if (!db) return json({ error: "Gerade nicht erreichbar." }, 503);
  if (!(await coachSignedIn(cookies))) return json(NOT_SIGNED_IN, 401);
  return (await deletePost(db, Number(params.id), new Date())) ? json({ ok: true }) : json({ error: "Den Beitrag gibt es nicht mehr." }, 404);
};
