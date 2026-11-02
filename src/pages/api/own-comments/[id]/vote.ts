import type { APIRoute } from "astro";
import { grown } from "../../../../lib/ownVotes.ts";
import { ownGuard, voterOf } from "../../../../lib/ownApi.ts";
import { json, readJson } from "../../../../lib/http.ts";

export const prerender = false;

/** POST /api/own-comments/<post id>/vote/ {comment, on}: upvote a comment, or take the upvote back. */
export const POST: APIRoute = async ({ params, request, cookies }) => {
  const own = ownGuard(request, params.id);
  if (own instanceof Response) return own;
  const { db, postId } = own;
  const body = await readJson<{ comment?: unknown; on?: unknown }>(request);
  if (body instanceof Response) return body;
  const commentId = Number(body.comment);
  const now = new Date();
  const c = await db.prepare("SELECT id, created_at, bot_upvotes FROM comments WHERE id = ? AND post_id = ? AND created_at <= ?")
    .bind(commentId, postId, now.toISOString()).first<{ id: number; created_at: string; bot_upvotes: number }>();
  if (!c) return json({ error: "Den Kommentar gibt es nicht mehr." }, 404);
  const voter = voterOf(cookies, true);
  // One vote per visitor and comment (primary key); a second tap with on=false takes it back.
  await db.prepare(body.on === false
    ? "DELETE FROM comment_votes WHERE comment_id = ? AND voter = ?"
    : "INSERT OR IGNORE INTO comment_votes (comment_id, voter) VALUES (?, ?)").bind(c.id, voter).run();
  const real = await db.prepare("SELECT COUNT(*) AS n FROM comment_votes WHERE comment_id = ?").bind(c.id).first<{ n: number }>();
  return json({ score: grown(c.bot_upvotes, c.created_at, now) + (real?.n ?? 0), voted: body.on !== false });
};
