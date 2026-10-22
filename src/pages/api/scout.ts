import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { isSameOrigin } from "../../lib/session.ts";
import { playerIds, SCOUT_MAX, scoutOwner } from "../../lib/scout.ts";

export const prerender = false;

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "private, no-store" } });

/** GET /api/scout/: this account's scout list ({ids, seenAt}); 401 without a login (the browser keeps it then). */
export const GET: APIRoute = async ({ cookies }) => {
  const owner = await scoutOwner(cookies, env.CREDENTIALS_KEY);
  const db = env.COMMENTS;
  if (!owner || !db) return json({ account: false }, 401);
  const [{ results }, seen] = await Promise.all([
    db.prepare("SELECT player_id FROM scout WHERE owner = ? ORDER BY added_at DESC").bind(owner).all<{ player_id: number }>(),
    db.prepare("SELECT seen_at FROM scout_seen WHERE owner = ?").bind(owner).first<{ seen_at: string }>(),
  ]);
  return json({ account: true, ids: results.map((r) => r.player_id), seenAt: seen?.seen_at });
};

/** POST /api/scout/ {add?: ids, remove?: ids, seen?: true}: changes the list; answers like GET. */
export const POST: APIRoute = async ({ request, cookies }) => {
  if (!isSameOrigin(request)) return json({ error: "Nicht erlaubt." }, 403);
  const owner = await scoutOwner(cookies, env.CREDENTIALS_KEY);
  const db = env.COMMENTS;
  if (!owner || !db) return json({ account: false }, 401);
  let raw: { add?: unknown; remove?: unknown; seen?: unknown };
  try { raw = await request.json(); } catch { return json({ error: "Ungültige Anfrage." }, 400); }
  const now = new Date().toISOString();
  const add = playerIds(raw.add), remove = playerIds(raw.remove);
  const count = await db.prepare("SELECT COUNT(*) AS n FROM scout WHERE owner = ?").bind(owner).first<{ n: number }>();
  const room = Math.max(0, SCOUT_MAX - (count?.n ?? 0));
  const statements = [
    ...add.slice(0, room).map((id) => db.prepare("INSERT OR IGNORE INTO scout (owner, player_id, added_at) VALUES (?, ?, ?)").bind(owner, id, now)),
    ...remove.map((id) => db.prepare("DELETE FROM scout WHERE owner = ? AND player_id = ?").bind(owner, id)),
    // The first player on the list starts the clock: only news after that is new.
    ...(raw.seen === true || add.length
      ? [db.prepare(raw.seen === true
          ? "INSERT INTO scout_seen (owner, seen_at) VALUES (?, ?) ON CONFLICT(owner) DO UPDATE SET seen_at = excluded.seen_at"
          : "INSERT OR IGNORE INTO scout_seen (owner, seen_at) VALUES (?, ?)").bind(owner, now)]
      : []),
  ];
  if (statements.length) await db.batch(statements);
  const [{ results }, seen] = await Promise.all([
    db.prepare("SELECT player_id FROM scout WHERE owner = ? ORDER BY added_at DESC").bind(owner).all<{ player_id: number }>(),
    db.prepare("SELECT seen_at FROM scout_seen WHERE owner = ?").bind(owner).first<{ seen_at: string }>(),
  ]);
  return json({ account: true, ids: results.map((r) => r.player_id), seenAt: seen?.seen_at });
};
