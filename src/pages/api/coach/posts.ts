import type { APIRoute } from "astro";
import { validate } from "../../../lib/coachPosts.ts";
import { listPosts, savePost } from "../../../lib/coachDb.ts";
import { coachGuard, json } from "../../../lib/coachApi.ts";
import { readJson } from "../../../lib/http.ts";

export const prerender = false;

/** GET /api/coach/posts/: the coach's posts, newest first. */
export const GET: APIRoute = async ({ request, cookies }) => {
  const db = await coachGuard(request, cookies);
  if (db instanceof Response) return db;
  return json({ posts: await listPosts(db) });
};

/** POST /api/coach/posts/ {type, data, publishedAt, pinnedHours, imageId?}: a new post. */
export const POST: APIRoute = async ({ request, cookies }) => {
  const db = await coachGuard(request, cookies);
  if (db instanceof Response) return db;
  const raw = await readJson(request);
  if (raw instanceof Response) return raw;
  const input = validate(raw, new Date());
  if ("error" in input) return json(input, 400);
  const post = await savePost(db, input, new Date());
  return post ? json({ post }) : json({ error: "Konnte nicht gespeichert werden." }, 500);
};
