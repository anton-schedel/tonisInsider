import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { isSameOrigin } from "../../../../lib/session.ts";
import { coachSignedIn, json, NOT_SIGNED_IN } from "../../../../lib/coachApi.ts";
import { endJob, resetJob, startJob, writeBots } from "../../../../lib/coachBotJob.ts";
import { startNow } from "../../../../lib/coachBots.ts";
import { modelConfig } from "../../../../lib/coachApi.ts";

export const prerender = false;

/**
 * POST /api/coach/bots/<id>/: (re)writes the post's bot comments that aren't out yet, or deletes them when the
 * post has bots off; ?more=N adds N to the ones there. Called by the coach page after a save; the model takes about a minute (up to 5 when it's
 * busy). If the page is closed meanwhile, the cron finishes the job (coachBotJob.ts).
 */
export const POST: APIRoute = async ({ request, cookies, params, url }) => {
  if (!isSameOrigin(request)) return json({ error: "Nicht erlaubt." }, 403);
  const db = env.COMMENTS;
  if (!db) return json({ error: "Gerade nicht erreichbar." }, 503);
  if (!(await coachSignedIn(cookies))) return json(NOT_SIGNED_IN, 401);
  const id = Number(params.id);
  // ?now=1: the planned ones come from now on instead of later.
  if (url.searchParams.get("now")) {
    const { results } = await db.prepare("SELECT id, created_at FROM comments WHERE post_id = ? AND sender = 'bot'").bind(id).all<{ id: number; created_at: string }>();
    const moved = startNow(results, new Date());
    if (moved.length) await db.batch(moved.map((r) => db.prepare("UPDATE comments SET created_at = ? WHERE id = ?").bind(r.created_at, r.id)));
    return json({ moved: moved.length });
  }
  await resetJob(db, id);
  await startJob(db, id);
  // ?more=20: that many more on top of the ones there.
  const more = Math.min(40, Math.max(0, Math.round(Number(url.searchParams.get("more")) || 0))) || undefined;
  const r = await writeBots(db, modelConfig(), id, more);
  await endJob(db, id, "bots" in r);
  return "bots" in r ? json(r) : json({ error: r.error }, r.status);
};

/** GET /api/coach/bots/<id>/: how many bot comments are out and how many still planned. */
export const GET: APIRoute = async ({ cookies, params }) => {
  const db = env.COMMENTS;
  if (!db) return json({ error: "Gerade nicht erreichbar." }, 503);
  if (!(await coachSignedIn(cookies))) return json(NOT_SIGNED_IN, 401);
  const now = new Date().toISOString();
  const r = await db.prepare("SELECT SUM(created_at <= ?) AS out, SUM(created_at > ?) AS planned FROM comments WHERE post_id = ? AND sender = 'bot'")
    .bind(now, now, Number(params.id)).first<{ out: number | null; planned: number | null }>();
  return json({ out: r?.out ?? 0, planned: r?.planned ?? 0 });
};
