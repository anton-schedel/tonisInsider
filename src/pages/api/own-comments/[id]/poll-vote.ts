import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { isSameOrigin } from "../../../../lib/session.ts";
import { isOwnPost } from "../../../../lib/ownComments.ts";
import { loadThreads } from "../../../../lib/ownCommentsDb.ts";
import { voterOf } from "../[id].ts";

export const prerender = false;

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "private, no-store" } });

/** POST /api/own-comments/<post id>/poll-vote/ {comment, option}: one vote per visitor and poll, final. */
export const POST: APIRoute = async ({ params, request, cookies }) => {
  if (!isSameOrigin(request)) return json({ error: "Nicht erlaubt." }, 403);
  const postId = Number(params.id);
  const db = env.COMMENTS;
  if (!isOwnPost(postId) || !db) return json({ error: "Nicht gefunden." }, 404);
  let body: { comment?: unknown; option?: unknown };
  try { body = await request.json(); } catch { return json({ error: "Ungültige Anfrage." }, 400); }
  const commentId = Number(body.comment);
  const optionId = Number(body.option);
  const now = new Date();
  const ok = await db.prepare(`SELECT o.id FROM poll_options o JOIN comments c ON c.id = o.comment_id
      WHERE o.id = ? AND o.comment_id = ? AND c.post_id = ? AND c.created_at <= ?`)
    .bind(optionId, commentId, postId, now.toISOString()).first();
  if (!ok) return json({ error: "Die Umfrage gibt es nicht mehr." }, 404);
  const voter = voterOf(cookies, true);
  const { meta } = await db.prepare("INSERT OR IGNORE INTO poll_votes (comment_id, voter, option_id) VALUES (?, ?, ?)").bind(commentId, voter, optionId).run();
  const { comments } = await loadThreads(db, postId, voter, now);
  const poll = comments.flatMap((t) => [t, ...t.replies]).find((x) => x.id === commentId)?.poll;
  return json({ poll }, meta.changes ? 200 : 409);
};
