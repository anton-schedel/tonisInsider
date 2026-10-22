import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { coachSignedIn, exportAllowed } from "../../../../lib/coachApi.ts";

export const prerender = false;

/** GET /api/coach/images/<id>/: the photo, for the coach's preview and the scrape run (token). */
export const GET: APIRoute = async ({ request, cookies, params }) => {
  const db = env.COMMENTS;
  if (!db) return new Response(null, { status: 503 });
  if (!exportAllowed(request) && !(await coachSignedIn(cookies))) return new Response(null, { status: 401 });
  const row = await db.prepare("SELECT body FROM coach_images WHERE id = ?").bind(String(params.id)).first<{ body: ArrayBuffer | number[] }>();
  if (!row) return new Response(null, { status: 404 });
  const bytes = row.body instanceof ArrayBuffer ? new Uint8Array(row.body) : new Uint8Array(row.body);
  return new Response(bytes, { headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=86400" } });
};
