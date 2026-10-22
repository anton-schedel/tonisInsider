import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { isSameOrigin } from "../../../../lib/session.ts";
import { getPost, listPosts } from "../../../../lib/coachDb.ts";
import { askModel, botPrompt, botRows, parseBots, shouldWriteBots } from "../../../../lib/coachBots.ts";
import { coachSignedIn, json, NOT_SIGNED_IN } from "../../../../lib/coachApi.ts";
import { kickoffDay } from "../../../../lib/format.ts";

export const prerender = false;

/**
 * POST /api/coach/bots/<id>/: (re)writes the post's bot comments that aren't out yet, or deletes them when the
 * post has bots off. Called by the coach page after a save; the model takes about a minute.
 */
export const POST: APIRoute = async ({ request, cookies, params }) => {
  if (!isSameOrigin(request)) return json({ error: "Nicht erlaubt." }, 403);
  const db = env.COMMENTS;
  if (!db) return json({ error: "Gerade nicht erreichbar." }, 503);
  if (!(await coachSignedIn(cookies))) return json(NOT_SIGNED_IN, 401);
  const post = await getPost(db, Number(params.id));
  if (!post) return json({ error: "Den Beitrag gibt es nicht mehr." }, 404);

  const now = new Date().toISOString();
  const clear = () => db.prepare("DELETE FROM comments WHERE post_id = ? AND sender = 'bot' AND created_at > ?").bind(post.id, now).run();
  const existing = await db.prepare("SELECT COUNT(*) AS n FROM comments WHERE post_id = ? AND sender = 'bot'").bind(post.id).first<{ n: number }>();
  const todo = shouldWriteBots(post, new Date(), existing?.n ?? 0);
  if (todo === "clear") {
    await clear();
    return json({ bots: 0 });
  }
  if (todo === "keep") return json({ bots: existing?.n ?? 0, kept: true });
  if (!env.MORPHEUS_API_KEY || !env.MORPHEUS_BASE_URL || !env.MORPHEUS_MODEL) return json({ error: "Bot-Kommentare sind noch nicht eingerichtet." }, 503);

  // The coach's earlier results, newest first.
  const recent = (await listPosts(db))
    .filter((p) => p.type === "result" && p.data.result && p.id !== post.id && p.publishedAt < post.publishedAt)
    .map((p) => `${kickoffDay(p.publishedAt).replace(/^\S+ /, "")}: ${p.data.result!.ours}:${p.data.result!.theirs} gegen ${p.data.result!.opponent}`);

  let bots;
  try {
    const answer = await askModel({ url: env.MORPHEUS_BASE_URL, key: env.MORPHEUS_API_KEY, model: env.MORPHEUS_MODEL }, botPrompt(post, recent));
    bots = parseBots(answer);
  } catch {
    return json({ error: "Bot-Kommentare konnten nicht erstellt werden." }, 502);
  }
  if (bots.length < 5) return json({ error: "Bot-Kommentare konnten nicht erstellt werden." }, 502);

  // A post that's already out gets its new comments from now on, not in the past.
  const start = post.publishedAt > now ? post.publishedAt : now;
  const rows = botRows(start, bots);
  await clear();
  const ids: number[] = [];
  for (const r of rows) {
    const parent = r.replyTo !== undefined ? ids[r.replyTo] ?? null : null;
    const { meta } = await db
      .prepare("INSERT INTO comments (post_id, parent_id, name, body, created_at, sender) VALUES (?, ?, ?, ?, ?, 'bot')")
      .bind(post.id, parent, r.name, r.body, r.createdAt)
      .run();
    ids.push(meta.last_row_id);
  }
  return json({ bots: rows.length });
};
