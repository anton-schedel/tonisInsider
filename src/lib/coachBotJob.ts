import type { D1 } from "cloudflare:workers";
import { insertComment, removeExtras } from "./ownCommentsDb.ts";
import { getPost, listPosts } from "./coachDb.ts";
import { applyPlan, askModel, catchUp, batchPlan, botCount, botNames, botPrompt, commentPlan, comparePlan, storiesOf, dropSimilar, pollAllowance, spread, botRows, parseBots, playerNames, shouldWriteBots, topicsOf, type BotComment, type ModelConfig } from "./coachBots.ts";
import { kickoffDay } from "./format.ts";

/**
 * Writing a post's bot comments takes a minute or more. The coach's page asks for it right after saving; if the
 * page is closed meanwhile, the request dies with it. So each job is noted in coach_bots, and the Worker's
 * 5-minute cron finishes the ones left pending (or failed), up to three tries.
 */
export type BotJob = { post_id: number; state: "pending" | "done" | "failed"; tries: number; updated_at: string };

/** A job the page may still be writing isn't touched before this. */
const STALE_MS = 6 * 60_000;
const MAX_TRIES = 3;
const PER_RUN = 2;

export function dueJobs(jobs: BotJob[], now: Date): BotJob[] {
  return jobs
    .filter((j) => j.state !== "done" && j.tries < MAX_TRIES && Date.parse(j.updated_at) <= now.getTime() - STALE_MS)
    .sort((a, b) => a.updated_at.localeCompare(b.updated_at))
    .slice(0, PER_RUN);
}

export type BotResult = { bots: number; kept?: boolean } | { error: string; status: number };

/**
 * (Re)writes the bot comments of one post that aren't out yet, or deletes them when it has bots off.
 * `more`: adds that many to the ones there (from now on), which they see and may answer.
 */
export async function writeBots(db: D1, cfg: ModelConfig | undefined, postId: number, more?: number): Promise<BotResult> {
  const post = await getPost(db, postId);
  if (!post) return { error: "Den Beitrag gibt es nicht mehr.", status: 404 };
  const now = new Date().toISOString();
  const clear = () => db.batch([
    ...removeExtras(db, "post_id = ? AND sender = 'bot' AND created_at > ?", post.id, now),
    db.prepare("DELETE FROM comments WHERE post_id = ? AND sender = 'bot' AND created_at > ?").bind(post.id, now),
  ]);
  const existing = await db.prepare("SELECT COUNT(*) AS n FROM comments WHERE post_id = ? AND sender = 'bot'").bind(post.id).first<{ n: number }>();
  const todo = more ? "write" : shouldWriteBots(post, new Date(), existing?.n ?? 0);
  if (todo === "clear") {
    await clear();
    return { bots: 0 };
  }
  if (todo === "keep") {
    const { results: rows } = await db.prepare("SELECT id, created_at FROM comments WHERE post_id = ? AND sender = 'bot'").bind(post.id).all<{ id: number; created_at: string }>();
    const moved = catchUp(rows, post.publishedAt, new Date());
    if (moved.length) await db.batch(moved.map((r) => db.prepare("UPDATE comments SET created_at = ? WHERE id = ?").bind(r.created_at, r.id)));
    return { bots: existing?.n ?? 0, kept: true };
  }
  if (!cfg) return { error: "Bot-Kommentare sind noch nicht eingerichtet.", status: 503 };

  // The coach's earlier results, newest first, and the rest of the club's story.
  const posts = await listPosts(db);
  const stories = storiesOf(posts, post);
  const recent = posts
    .filter((p) => p.type === "result" && p.data.result && p.id !== post.id && p.publishedAt < post.publishedAt)
    .map((p) => `${kickoffDay(p.publishedAt).replace(/^\S+ /, "")}: ${p.data.result!.ours}:${p.data.result!.theirs} gegen ${p.data.result!.opponent}`);

  // What's there already (when adding more): so they don't repeat it and can answer it.
  const { results: there } = more
    ? await db.prepare("SELECT name, body FROM comments WHERE post_id = ? AND created_at <= ? ORDER BY created_at DESC LIMIT 25").bind(post.id, now).all<{ name: string; body: string }>()
    : { results: [] };
  const existingTexts = there.reverse().map((c) => `${c.name}: ${c.body}`);

  // Batches (Morpheus only) run in parallel; replies stay within their batch.
  const plan = batchPlan(more ?? botCount(), topicsOf(post.data.bots?.context), cfg.batch);
  // One or two polls per post in all: a rewrite starts afresh, "more" counts the polls already there.
  const pollsThere = more
    ? (await db.prepare("SELECT COUNT(*) AS n FROM polls p JOIN comments c ON c.id = p.comment_id WHERE c.post_id = ?").bind(post.id).first<{ n: number }>())?.n ?? 0
    : 0;
  const allowed = pollAllowance(plan.length, pollsThere);
  // Each post (and batch) compares differently, or not at all; and doesn't sound like the bots under other posts.
  const pool = Math.floor(Math.random() * 4);
  const compare = comparePlan();
  const comparisons = spread(more ? Math.min(1, compare.count) : compare.count, plan.length);
  const { results: before } = await db
    .prepare("SELECT body FROM comments WHERE sender = 'bot' AND post_id != ? ORDER BY RANDOM() LIMIT 20").bind(post.id).all<{ body: string }>();
  const earlier = before.map((c) => c.body);
  // Each batch gets its plan: what each of its comments is about.
  const slots = plan.map((b, i) => commentPlan(b.count, { topics: b.topics, stories, compare: comparisons[i], forms: compare.forms, polls: allowed[i] }));
  const answers = await Promise.allSettled(plan.map((b, i) => askModel(cfg, botPrompt(post, recent, {
    ...b, plan: slots[i], existing: existingTexts, batch: pool + i, earlier,
  }))));
  let bots: BotComment[] = [];
  answers.forEach((a, i) => {
    if (a.status !== "fulfilled") return;
    const offset = bots.length;
    bots.push(...applyPlan(parseBots(a.value), slots[i]).map((c) => c.replyTo !== undefined ? { ...c, replyTo: c.replyTo + offset } : c));
  });
  bots = dropSimilar(bots);
  const names = botNames(bots.length, playerNames(post));
  bots = bots.map((b, i) => ({ ...b, name: names[i] }));
  // The same person now and then, but never answering themselves.
  bots.forEach((b, i) => { if (b.replyTo !== undefined && bots[b.replyTo].name === b.name) bots[i] = { ...b, name: botNames(1, [...playerNames(post), ...names.map((n) => n.toLowerCase())])[0] }; });
  if (bots.length < Math.min(5, more ?? 5)) return { error: "Bot-Kommentare konnten nicht erstellt werden.", status: 502 };

  // A post that's already out gets its new comments from now on (after the model's minutes), not in the past.
  const written = new Date().toISOString();
  const rows = botRows(post.publishedAt > written ? post.publishedAt : written, bots);
  if (!more) await clear();
  const ids: number[] = [];
  for (const r of rows) {
    const parent = r.replyTo !== undefined ? ids[r.replyTo] ?? null : null;
    ids.push(await insertComment(db, {
      postId: post.id, parent, name: r.name, text: r.poll?.question ?? r.body, createdAt: r.createdAt, sender: "bot",
      ...(r.upvotes !== undefined ? { upvotes: r.upvotes } : {}),
      ...(r.poll ? { poll: r.poll } : {}),
    }));
  }
  return { bots: rows.length };
}

/** Notes a job as started (tries + 1) before writing; the cron sees it as left over if it stays pending. */
export const startJob = (db: D1, postId: number) =>
  db.prepare(`INSERT INTO coach_bots (post_id, state, tries, updated_at) VALUES (?, 'pending', 1, ?)
    ON CONFLICT(post_id) DO UPDATE SET state = 'pending', tries = tries + 1, updated_at = excluded.updated_at`)
    .bind(postId, new Date().toISOString()).run();

export const endJob = (db: D1, postId: number, ok: boolean) =>
  db.prepare("UPDATE coach_bots SET state = ?, updated_at = ? WHERE post_id = ?").bind(ok ? "done" : "failed", new Date().toISOString(), postId).run();

/** A new save starts the tries afresh. */
export const resetJob = (db: D1, postId: number) => db.prepare("DELETE FROM coach_bots WHERE post_id = ?").bind(postId).run();

/** The cron's part: finish jobs the page left behind. */
export async function runDueJobs(db: D1, cfg: ModelConfig | undefined): Promise<void> {
  const { results } = await db.prepare("SELECT post_id, state, tries, updated_at FROM coach_bots WHERE state != 'done'").bind().all<BotJob>();
  for (const job of dueJobs(results, new Date())) {
    await startJob(db, job.post_id);
    const r = await writeBots(db, cfg, job.post_id);
    await endJob(db, job.post_id, "bots" in r);
  }
}
