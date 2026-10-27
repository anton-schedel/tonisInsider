import type { APIRoute } from "astro";
import { coachGuard, json } from "../../../../lib/coachApi.ts";
import { COACH_ID_MIN } from "../../../../lib/coachPosts.ts";
import { removeExtras } from "../../../../lib/ownCommentsDb.ts";

export const prerender = false;

/** DELETE /api/coach/comments/<id>/: the coach removes a comment (and its replies) under one of their posts. */
export const DELETE: APIRoute = async ({ request, cookies, params }) => {
  const db = await coachGuard(request, cookies);
  if (db instanceof Response) return db;
  const id = Number(params.id);
  const row = await db.prepare("SELECT post_id FROM comments WHERE id = ?").bind(id).first<{ post_id: number }>();
  if (!row || row.post_id < COACH_ID_MIN) return json({ error: "Den Kommentar gibt es nicht mehr." }, 404);
  await db.batch([
    // Its poll and votes, and those of its replies, go with it.
    ...removeExtras(db, "id = ? OR parent_id = ?", id, id),
    db.prepare("DELETE FROM comments WHERE parent_id = ?").bind(id),
    db.prepare("DELETE FROM comments WHERE id = ?").bind(id),
  ]);
  return json({ ok: true });
};
