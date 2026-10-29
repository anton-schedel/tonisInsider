import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { D1 } from "cloudflare:workers";
import { listTeamPhotos, saveTeamPhoto } from "./coachDb.ts";

/** The real migrations in an in-memory SQLite, behind the bit of D1 coachDb uses (errors come when run, as on D1). */
function db(migrations: string[]): D1 {
  const sql = new DatabaseSync(":memory:");
  for (const m of migrations) sql.exec(readFileSync(join(process.cwd(), "migrations", m), "utf8"));
  const prepare = (q: string) => ({
    bind: (...v: SQLInputValue[]) => ({
      first: async () => { const r = sql.prepare(q).get(...v); return r ? { ...r } : null; },
      all: async () => ({ results: sql.prepare(q).all(...v).map((r) => ({ ...r })) }),
      run: async () => ({ meta: { changes: Number(sql.prepare(q).run(...v).changes) } }),
    }),
  });
  return { prepare } as unknown as D1;
}

const PHOTO = "0123456789abcdef";
const OTHER = "1111111111111111";
const AVATAR = "fedcba9876543210";
const NOW = new Date("2026-10-29T12:00:00.000Z");
const ALL = ["0003_coach_posts.sql", "0006_coach_team_photos.sql", "0007_team_photo_avatars.sql"];

async function withImages(d: D1) {
  for (const [id, w, h] of [[PHOTO, 1024, 1365], [OTHER, 900, 1200], [AVATAR, 480, 480]] as const) {
    await d.prepare("INSERT INTO coach_images (id, width, height, body, created_at) VALUES (?, ?, ?, ?, ?)").bind(id, w, h, new Uint8Array([0xff, 0xd8]), NOW.toISOString()).run();
  }
  return d;
}

describe("team photo avatars", () => {
  it("stores an avatar with the photo and lists it", async () => {
    const d = await withImages(db(ALL));
    expect(await saveTeamPhoto(d, "Luca Loibl", PHOTO, NOW, AVATAR)).toBe(true);
    expect(await listTeamPhotos(d)).toEqual([{ player: "Luca Loibl", imageId: PHOTO, width: 1024, height: 1365, avatarId: AVATAR }]);
  });

  it("keeps the avatar when the same photo is saved again without one, clears it for a new photo", async () => {
    const d = await withImages(db(ALL));
    await saveTeamPhoto(d, "Luca Loibl", PHOTO, NOW, AVATAR);
    await saveTeamPhoto(d, "luca loibl", PHOTO, NOW);
    expect((await listTeamPhotos(d))[0]).toMatchObject({ player: "luca loibl", avatarId: AVATAR });
    await saveTeamPhoto(d, "Luca Loibl", OTHER, NOW);
    expect((await listTeamPhotos(d))[0]).not.toHaveProperty("avatarId");
  });

  it("refuses an avatar that is not a stored image", async () => {
    const d = await withImages(db(ALL));
    expect(await saveTeamPhoto(d, "Luca Loibl", PHOTO, NOW, "aaaaaaaaaaaaaaaa")).toBe(false);
    expect(await listTeamPhotos(d)).toEqual([]);
  });

  it("before migration 0007: lists and saves photos without avatars instead of failing", async () => {
    const d = await withImages(db(ALL.slice(0, 2)));
    expect(await saveTeamPhoto(d, "Luca Loibl", PHOTO, NOW)).toBe(true);
    expect(await listTeamPhotos(d)).toEqual([{ player: "Luca Loibl", imageId: PHOTO, width: 1024, height: 1365 }]);
    await expect(saveTeamPhoto(d, "Luca Loibl", PHOTO, NOW, AVATAR)).rejects.toThrow();
  });

  it("without the table (before migration 0006) it still fails, for the callers to catch", async () => {
    await expect(listTeamPhotos(db(ALL.slice(0, 1)))).rejects.toThrow(/coach_team_photos/);
  });
});
