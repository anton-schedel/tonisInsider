import type { APIRoute } from "astro";
import { deleteTeamPhoto, listTeamPhotos, saveTeamPhoto } from "../../../lib/coachDb.ts";
import { coachGuard, json } from "../../../lib/coachApi.ts";
import { readJson } from "../../../lib/http.ts";
import { validateTeamPhoto } from "../../../lib/teamPhotos.ts";

export const prerender = false;

/** GET /api/coach/team-photos/: { photos: [{ player, imageId, width, height, avatarId? }] }, by name. */
export const GET: APIRoute = async ({ request, cookies }) => {
  const db = await coachGuard(request, cookies);
  if (db instanceof Response) return db;
  return json({ photos: await listTeamPhotos(db).catch(() => []) });
};

/**
 * PUT /api/coach/team-photos/ { player, imageId, avatarId? }: sets (or replaces) a player's photo and its avatar (one
 * without keeps the avatar only for the same photo); answers with all of them.
 */
export const PUT: APIRoute = async ({ request, cookies }) => {
  const db = await coachGuard(request, cookies);
  if (db instanceof Response) return db;
  const raw = await readJson(request);
  if (raw instanceof Response) return raw;
  const input = validateTeamPhoto(raw);
  if ("error" in input) return json(input, 400);
  if (!(await saveTeamPhoto(db, input.player, input.imageId, new Date(), input.avatarId))) return json({ error: "Foto nicht gefunden." }, 404);
  return json({ photos: await listTeamPhotos(db) });
};

/** DELETE /api/coach/team-photos/?player=…: forgets the photo (the image itself stays); answers with the rest. */
export const DELETE: APIRoute = async ({ request, cookies, url }) => {
  const db = await coachGuard(request, cookies);
  if (db instanceof Response) return db;
  const player = url.searchParams.get("player") ?? "";
  if (!(await deleteTeamPhoto(db, player))) return json({ error: "Nicht gefunden." }, 404);
  return json({ photos: await listTeamPhotos(db) });
};
