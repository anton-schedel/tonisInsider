import type { APIRoute } from "astro";
import { loadThreads } from "../../../../lib/ownCommentsDb.ts";
import { ownGuard, voterOf } from "../../../../lib/ownApi.ts";
import { json, readJson } from "../../../../lib/http.ts";

export const prerender = false;

/** POST /api/own-comments/<post id>/poll-vote/ {comment, option}: one vote per visitor and poll, final. */
export const POST: APIRoute = async ({ params, request, cookies }) => {
  const own = ownGuard(request, params.id);
  if (own instanceof Response) return own;
  const { db, postId } = own;
  const body = await readJson<{ comment?: unknown; option?: unknown }>(request);
  if (body instanceof Response) return body;
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
