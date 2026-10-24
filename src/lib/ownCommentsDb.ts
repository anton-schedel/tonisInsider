import type { D1 } from "cloudflare:workers";
import { toThreads, type OwnComment, type Row } from "./ownComments.ts";
import { botPollVotes, botUpvotes, pollView, type NewPoll, type PollView } from "./ownVotes.ts";

/** The comments of one own post that are out, with upvotes and polls as this visitor sees them. */
export async function loadThreads(db: D1, postId: number, voter: string, now: Date): Promise<{ total: number; comments: OwnComment[] }> {
  const at = now.toISOString();
  const { results: rows } = await db
    .prepare(`SELECT c.id, c.parent_id, c.name, c.body, c.created_at, c.bot_upvotes,
        (SELECT COUNT(*) FROM comment_votes v WHERE v.comment_id = c.id) AS real_upvotes,
        EXISTS (SELECT 1 FROM comment_votes v WHERE v.comment_id = c.id AND v.voter = ?) AS voted
      FROM comments c WHERE c.post_id = ? AND c.created_at <= ? ORDER BY c.created_at, c.id`)
    .bind(voter, postId, at)
    .all<Row>();
  const { results: options } = await db
    .prepare(`SELECT o.id, o.comment_id, o.label, o.bot_votes, p.question, c.created_at,
        (SELECT COUNT(*) FROM poll_votes v WHERE v.option_id = o.id) AS real,
        (SELECT option_id FROM poll_votes v WHERE v.comment_id = o.comment_id AND v.voter = ?) AS mine
      FROM poll_options o JOIN polls p ON p.comment_id = o.comment_id JOIN comments c ON c.id = o.comment_id
      WHERE c.post_id = ? AND c.created_at <= ? ORDER BY o.comment_id, o.position`)
    .bind(voter, postId, at)
    .all<{ id: number; comment_id: number; label: string; bot_votes: number; question: string; created_at: string; real: number; mine: number | null }>();
  const polls = new Map<number, PollView>();
  const byComment = Map.groupBy(options, (o) => o.comment_id);
  for (const [id, opts] of byComment) {
    const first = opts[0];
    polls.set(id, pollView(first.question, opts.map((o) => ({ id: o.id, label: o.label, bot: o.bot_votes, real: o.real })), first.created_at, now, first.mine ?? undefined));
  }
  return { total: rows.length, comments: toThreads(rows, polls, now) };
}

/** Saves a comment (and its poll) with bot votes, so visitors' and bots' comments look alike. */
export async function insertComment(
  db: D1,
  c: { postId: number; parent?: number | null; name: string; text: string; createdAt: string; sender: string; upvotes?: number; poll?: NewPoll & { votes?: number[] } },
): Promise<number> {
  const { meta } = await db
    .prepare("INSERT INTO comments (post_id, parent_id, name, body, created_at, sender, bot_upvotes) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(c.postId, c.parent ?? null, c.name, c.text, c.createdAt, c.sender, c.upvotes ?? botUpvotes())
    .run();
  const id = meta.last_row_id;
  if (c.poll) {
    const votes = c.poll.votes?.length === c.poll.options.length ? c.poll.votes : botPollVotes(c.poll.options.length);
    await db.batch([
      db.prepare("INSERT INTO polls (comment_id, question) VALUES (?, ?)").bind(id, c.poll.question),
      ...c.poll.options.map((label, i) =>
        db.prepare("INSERT INTO poll_options (comment_id, position, label, bot_votes) VALUES (?, ?, ?, ?)").bind(id, i, label, votes[i])),
    ]);
  }
  return id;
}

/** Statements that remove comments' polls and votes (before or with the comments themselves). */
export function removeExtras(db: D1, where: string, ...binds: unknown[]) {
  return ["comment_votes", "poll_votes", "poll_options", "polls"].map((t) =>
    db.prepare(`DELETE FROM ${t} WHERE comment_id IN (SELECT id FROM comments WHERE ${where})`).bind(...binds));
}
