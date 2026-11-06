import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { parseNewComment, RATE, senderKey } from "../../../lib/ownComments.ts";
import { parseNewPoll } from "../../../lib/ownVotes.ts";
import { insertComment, loadThreads } from "../../../lib/ownCommentsDb.ts";
import { json, readJson } from "../../../lib/http.ts";
import { ownGuard, voterOf } from "../../../lib/ownApi.ts";
import { recordChat } from "../../../lib/chatsServer.ts";
import { textStart } from "../../../lib/chats.ts";

export const prerender = false;

/** GET /api/own-comments/<post id>/: the comments on one of our own posts, with upvotes and polls. */
export const GET: APIRoute = async ({ params, request, cookies }) => {
  const own = ownGuard(request, params.id);
  if (own instanceof Response) return own;
  const { db, postId: id } = own;
  // Comments dated in the future (prepared ones) appear only when their time comes, their polls with them.
  // The visitor's id is set here already, so quick taps right after loading all carry the same one.
  return json(await loadThreads(db, id, voterOf(cookies, true), new Date()));
};

/**
 * POST /api/own-comments/<post id>/ {name, text, parent?} or {name, poll: {question, options}}: anyone can
 * comment or start a poll, under a name of their choice.
 */
export const POST: APIRoute = async ({ params, request, cookies, url }) => {
  const own = ownGuard(request, params.id);
  if (own instanceof Response) return own;
  const { db, postId: id } = own;
  const raw = await readJson(request);
  if (raw instanceof Response) return raw;
  const r = raw as { poll?: unknown; text?: unknown };
  const poll = r?.poll ? parseNewPoll(r.poll) : undefined;
  if (poll && "error" in poll) return json(poll, 400);
  // A poll needs no text: its question is the comment.
  const c = parseNewComment(poll ? { ...r, text: String(r.text ?? "").trim() || poll.question } : raw);
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
  const newId = await insertComment(db, { postId: id, parent: c.parent, name: c.name, text: c.text, createdAt: at, sender, ...(poll ? { poll } : {}) });
  // "Deine Chats", when signed in to LigaInsider (anyone may write here under any name).
  await recordChat(cookies, url, {
    thread: String(id), root: c.parent ?? newId, id: newId, kind: poll ? "poll" : c.parent ? "answer" : "comment", text: textStart(poll?.question ?? c.text),
  });
  // The saved comment as the thread list shows it (its bot votes start at 0 and grow).
  const { comments } = await loadThreads(db, id, voterOf(cookies), new Date());
  const saved = comments.flatMap((t) => [t, ...t.replies]).find((x) => x.id === newId);
  return json({ ok: true, comment: saved });
};
