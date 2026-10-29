import type { Article } from "../../scraper/types.ts";
import { CLUB_BANNER } from "./coachPosts.ts";

/**
 * The coach's team photos (/schnoeselmob/, table coach_team_photos): one photo per player, picked in the editor
 * instead of uploading it again, and used by the hand-written own posts (content/posts/, via "teamPhoto").
 * No Worker or Node imports: the editor's bundle uses it too.
 */
export type TeamPhoto = { player: string; imageId: string; width: number; height: number };

/** store/team-photos.json (written by the scrape run): player → the photo as built into the site. */
export type TeamPhotoMap = Record<string, { photo: string; width: number; height: number }>;

const HEX16 = /^[0-9a-f]{16}$/;
const tidy = (s: string) => s.trim().replace(/\s+/g, " ");
const norm = (s: string) => tidy(s).toLocaleLowerCase("de");

/** PUT /api/coach/team-photos/'s body, checked (that the image exists is the route's job). */
export function validateTeamPhoto(raw: unknown): { player: string; imageId: string } | { error: string } {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const player = typeof r.player === "string" ? tidy(r.player) : "";
  if (player.length < 2 || player.length > 40) return { error: "Der Name braucht 2 bis 40 Zeichen." };
  if (typeof r.imageId !== "string" || !HEX16.test(r.imageId)) return { error: "Ungültige Anfrage." };
  return { player, imageId: r.imageId };
}

/**
 * The team photo for a name as typed: the same name in any case, or just the last name ("Loibl" → "Luca Loibl")
 * when only one player has it. A full name that differs ("Max Loibl") is someone else.
 */
export function findTeamPhoto<T extends { player: string }>(name: string, photos: T[]): T | undefined {
  const n = norm(name);
  if (n.length < 2) return undefined;
  const same = photos.find((p) => norm(p.player) === n);
  if (same || n.includes(" ")) return same;
  const byLast = photos.filter((p) => norm(p.player).split(" ").at(-1) === n);
  return byLast.length === 1 ? byLast[0] : undefined;
}

/** A hand-written own post as stored: its player may name a team photo instead of a file. */
export type OwnPostJson = Article & { player?: Article["player"] & { teamPhoto?: string } };

/**
 * Resolves "player": { …, "teamPhoto": "Kevin Nguyen" }: his team photo as the player's picture and, unless the
 * post brings its own, as the banner. Without one stored (yet) the post shows no photo (the crest) and the club's
 * banner, never a broken image.
 */
export function withTeamPhoto(a: OwnPostJson, photos: TeamPhotoMap): Article {
  if (!a.player || a.player.teamPhoto === undefined) return a;
  const { teamPhoto, ...player } = a.player;
  const found = findTeamPhoto(teamPhoto, Object.entries(photos).map(([name, p]) => ({ player: name, ...p })));
  const out: Article = { ...a, player: found ? { ...player, photo: found.photo } : player };
  if (a.banner === undefined) {
    out.banner = found?.photo ?? CLUB_BANNER;
    if (found) out.bannerSize = { width: found.width, height: found.height };
    else delete out.bannerSize;
  }
  return out;
}
