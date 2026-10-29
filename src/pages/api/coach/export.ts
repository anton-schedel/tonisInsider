import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { exportPosts, listTeamPhotos } from "../../../lib/coachDb.ts";
import { exportAllowed, json } from "../../../lib/coachApi.ts";

export const prerender = false;

/** GET /api/coach/export/ (header x-export-token): every live coach post and the team photos, for the scrape run. */
export const GET: APIRoute = async ({ request }) => {
  const db = env.COMMENTS;
  if (!db) return json({ error: "Gerade nicht erreichbar." }, 503);
  if (!exportAllowed(request)) return json({ error: "Nicht erlaubt." }, 401);
  // Before migration 0006 the table is missing: leave team photos out (the scrape run keeps its last map).
  const teamPhotos = await listTeamPhotos(db).catch(() => undefined);
  return json({ posts: await exportPosts(db), ...(teamPhotos ? { teamPhotos } : {}) });
};
