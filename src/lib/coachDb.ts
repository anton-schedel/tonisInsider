import type { D1 } from "cloudflare:workers";
import { removeExtras } from "./ownCommentsDb.ts";
import { COACH_ID_MIN, type CoachInput, type CoachPost, type CoachType } from "./coachPosts.ts";

/** coach_posts joined with its image's size. */
export type CoachRow = {
  id: number; type: string; data: string; published_at: string; pinned_until: string | null;
  image_id: string | null; image_w: number | null; image_h: number | null; updated_at: string;
};

const SELECT = `SELECT p.id, p.type, p.data, p.published_at, p.pinned_until, p.image_id, i.width AS image_w, i.height AS image_h, p.updated_at
  FROM coach_posts p LEFT JOIN coach_images i ON i.id = p.image_id`;

export function fromRow(r: CoachRow): CoachPost {
  return {
    id: r.id,
    type: r.type as CoachType,
    data: JSON.parse(r.data),
    publishedAt: r.published_at,
    ...(r.pinned_until ? { pinnedUntil: r.pinned_until } : {}),
    ...(r.image_id && r.image_w && r.image_h ? { image: { id: r.image_id, width: r.image_w, height: r.image_h } } : {}),
    updatedAt: r.updated_at,
  };
}

export const nextId = (max: number | null) => (max && max >= COACH_ID_MIN ? max + 1 : COACH_ID_MIN);

export const pinnedUntil = (publishedAt: string, hours: number) =>
  hours > 0 ? new Date(Date.parse(publishedAt) + hours * 3_600_000).toISOString() : null;

/** The coach's posts, newest first (deleted ones left out). */
export async function listPosts(db: D1): Promise<CoachPost[]> {
  const { results } = await db.prepare(`${SELECT} WHERE p.deleted = 0 ORDER BY p.published_at DESC`).bind().all<CoachRow>();
  return results.map(fromRow);
}

export async function getPost(db: D1, id: number): Promise<CoachPost | undefined> {
  const r = await db.prepare(`${SELECT} WHERE p.id = ? AND p.deleted = 0`).bind(id).first<CoachRow>();
  return r ? fromRow(r) : undefined;
}

/** Creates (no id) or replaces a post; returns it as stored. */
export async function savePost(db: D1, input: CoachInput, now: Date, id?: number): Promise<CoachPost | undefined> {
  const values = [input.type, JSON.stringify(input.data), input.publishedAt, pinnedUntil(input.publishedAt, input.pinnedHours), input.imageId ?? null, now.toISOString()];
  if (id === undefined) {
    const max = await db.prepare("SELECT MAX(id) AS max FROM coach_posts").bind().first<{ max: number | null }>();
    id = nextId(max?.max ?? null);
    await db.prepare("INSERT INTO coach_posts (type, data, published_at, pinned_until, image_id, updated_at, id) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(...values, id).run();
  } else {
    const { meta } = await db.prepare("UPDATE coach_posts SET type = ?, data = ?, published_at = ?, pinned_until = ?, image_id = ?, updated_at = ? WHERE id = ? AND deleted = 0").bind(...values, id).run();
    if (!meta.changes) return undefined;
  }
  return getPost(db, id);
}

/** Marks it deleted (the next build drops it) and removes its bot comments. */
export async function deletePost(db: D1, id: number, now: Date): Promise<boolean> {
  const { meta } = await db.prepare("UPDATE coach_posts SET deleted = 1, updated_at = ? WHERE id = ? AND deleted = 0").bind(now.toISOString(), id).run();
  if (!meta.changes) return false;
  await db.batch([...removeExtras(db, "post_id = ? AND sender = 'bot'", id), db.prepare("DELETE FROM comments WHERE post_id = ? AND sender = 'bot'").bind(id)]);
  return true;
}

/** For the build: every live post. */
export async function exportPosts(db: D1): Promise<CoachPost[]> {
  return listPosts(db);
}
