import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { isSameOrigin } from "../../../../lib/session.ts";
import { isOwnPost } from "../../../../lib/ownComments.ts";
import { grown } from "../../../../lib/ownVotes.ts";
import { voterOf } from "../[id].ts";

export const prerender = false;

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "private, no-store" } });

/** POST /api/own-comments/<post id>/vote/ {comment, on}: upvote a comment, or take the upvote back. */
export const POST: APIRoute = async ({ params, request, cookies }) => {
  if (!isSameOrigin(request)) return json({ error: "Nicht erlaubt." }, 403);
  const postId = Number(params.id);
  const db = env.COMMENTS;
  if (!isOwnPost(postId) || !db) return json({ error: "Nicht gefunden." }, 404);
  let body: { comment?: unknown; on?: unknown };
  try { body = (await request.json()) ?? {}; } catch { return json({ error: "Ungültige Anfrage." }, 400); }
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
