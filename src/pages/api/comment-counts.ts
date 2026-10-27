import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { commentCountsResponse } from "../../lib/comments.ts";
import { edgeCache, json, later } from "../../lib/http.ts";
import { isOwnPost } from "../../lib/ownComments.ts";
import { commentTotals } from "../../lib/ownCommentsDb.ts";

export const prerender = false;

/**
 * GET /api/comment-counts/?own=<id>,<id>: article id → comment count for LigaInsider's newest articles, and for
 * the listed own posts their comment totals (from our database, so that answer isn't cached).
 */
export const GET: APIRoute = async ({ url, locals }) => {
  const li = commentCountsResponse(fetch, edgeCache(), later(locals));
  const own = (url.searchParams.get("own") ?? "").split(",").map(Number).filter(isOwnPost).slice(0, 50);
  const db = env.COMMENTS;
  if (!own.length || !db) return li;
  const [res, totals] = await Promise.all([li, commentTotals(db, own, new Date()).catch(() => ({}))]);
  const counts = res.ok ? ((await res.json()) as Record<string, number>) : {};
  return json({ ...counts, ...totals });
};
