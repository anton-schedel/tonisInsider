import type { APIRoute } from "astro";
import { validate } from "../../../../lib/coachPosts.ts";
import { deletePost, savePost } from "../../../../lib/coachDb.ts";
import { coachGuard, json } from "../../../../lib/coachApi.ts";
import { readJson } from "../../../../lib/http.ts";

export const prerender = false;

/** PUT /api/coach/posts/<id>/: replaces the post. */
export const PUT: APIRoute = async ({ request, cookies, params }) => {
  const db = await coachGuard(request, cookies);
  if (db instanceof Response) return db;
  const raw = await readJson(request);
  if (raw instanceof Response) return raw;
  const input = validate(raw, new Date());
  if ("error" in input) return json(input, 400);
  const post = await savePost(db, input, new Date(), Number(params.id));
  return post ? json({ post }) : json({ error: "Den Beitrag gibt es nicht mehr." }, 404);
};

/** DELETE /api/coach/posts/<id>/: gone with the next build, its bot comments at once. */
export const DELETE: APIRoute = async ({ request, cookies, params }) => {
  const db = await coachGuard(request, cookies);
  if (db instanceof Response) return db;
  return (await deletePost(db, Number(params.id), new Date())) ? json({ ok: true }) : json({ error: "Den Beitrag gibt es nicht mehr." }, 404);
};
