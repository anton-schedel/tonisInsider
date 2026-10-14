import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { isSameOrigin } from "../../../lib/session.ts";
import { isOwnPost, parseNewComment, RATE, senderKey, toThreads, type Row } from "../../../lib/ownComments.ts";

export const prerender = false;

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });

/** GET /api/own-comments/<post id>/: the comments on one of our own posts, as threads. */
export const GET: APIRoute = async ({ params }) => {
  const id = Number(params.id);
  const db = env.COMMENTS;
  if (!isOwnPost(id) || !db) return json({ error: "Nicht gefunden." }, 404);
  const { results } = await db
    .prepare("SELECT id, parent_id, name, body, created_at FROM comments WHERE post_id = ? ORDER BY created_at, id")
    .bind(id)
    .all<Row>();
  return json({ total: results.length, comments: toThreads(results) });
};

/** POST /api/own-comments/<post id>/ {name, text, parent?}: anyone can comment, under a name of their choice. */
export const POST: APIRoute = async ({ params, request }) => {
  if (!isSameOrigin(request)) return json({ error: "Nicht erlaubt." }, 403);
  const id = Number(params.id);
  const db = env.COMMENTS;
  if (!isOwnPost(id) || !db) return json({ error: "Nicht gefunden." }, 404);
  let raw: unknown;
  try { raw = await request.json(); } catch { return json({ error: "Ungültige Anfrage." }, 400); }
  const c = parseNewComment(raw);
  if ("error" in c) return json(c, 400);

  const sender = await senderKey(request.headers.get("cf-connecting-ip") ?? "", env.CREDENTIALS_KEY ?? "tonisinsider");
  const since = new Date(Date.now() - RATE.windowMs).toISOString();
  const recent = await db.prepare("SELECT COUNT(*) AS n FROM comments WHERE sender = ? AND created_at > ?").bind(sender, since).first<{ n: number }>();
  if ((recent?.n ?? 0) >= RATE.count) return json({ error: "Kurz durchatmen: du hast gerade viel geschrieben." }, 429);
  if (c.parent) {
    const parent = await db.prepare("SELECT id FROM comments WHERE id = ? AND post_id = ? AND parent_id IS NULL").bind(c.parent, id).first();
    if (!parent) return json({ error: "Den Kommentar gibt es nicht mehr." }, 400);
  }
  const at = new Date().toISOString();
  const { meta } = await db
    .prepare("INSERT INTO comments (post_id, parent_id, name, body, created_at, sender) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(id, c.parent ?? null, c.name, c.text, at, sender)
    .run();
  return json({ ok: true, comment: { id: meta.last_row_id, user: c.name, date: at, text: c.text, replies: [] } });
};
