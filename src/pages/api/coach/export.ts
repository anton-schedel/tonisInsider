import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { exportPosts } from "../../../lib/coachDb.ts";
import { exportAllowed, json } from "../../../lib/coachApi.ts";

export const prerender = false;

/** GET /api/coach/export/ (header x-export-token): every live coach post, for the scrape run. */
export const GET: APIRoute = async ({ request }) => {
  const db = env.COMMENTS;
  if (!db) return json({ error: "Gerade nicht erreichbar." }, 503);
  if (!exportAllowed(request)) return json({ error: "Nicht erlaubt." }, 401);
  return json({ posts: await exportPosts(db) });
};
