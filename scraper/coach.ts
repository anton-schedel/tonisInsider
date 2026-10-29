import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { dueCoach, imagePath } from "../src/lib/coachPosts.ts";
import type { TeamPhoto, TeamPhotoMap } from "../src/lib/teamPhotos.ts";

/** Posts the build includes now (due within the lead time): a new one entering means a rebuild. */
export const coachDueIds = (posts: { id: number; publishedAt: string }[], now: Date) =>
  dueCoach(posts, now).map((p) => p.id).sort((a, b) => a - b);

/**
 * The coach's posts (/schnoeselmob/, stored in D1): fetched from the site's export each run into
 * store/coach-posts.json, with their photos and the feed's round cuts (data.thumb) in public/img/custom/coach/.
 * The team photos go there too, named in teamFile (store/team-photos.json, player → photo) for the hand-written
 * own posts. A change (new, edited or deleted post or team photo) means a rebuild; a failed fetch keeps the last ones.
 */
export async function pullCoachPosts(o: { site: string; token: string; file: string; imgDir: string; teamFile?: string; fetcher?: typeof fetch }): Promise<{ changed: boolean; problem?: string }> {
  const fetcher = o.fetcher ?? fetch;
  const site = o.site.replace(/\/+$/, "");
  const headers = { "x-export-token": o.token };
  let posts: { image?: { id: string }; data?: { thumb?: { imageId?: string } } }[];
  // Missing from an export before team photos existed: the last map stays.
  let team: TeamPhoto[] | undefined;
  try {
    const res = await fetcher(`${site}/api/coach/export/`, { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { posts: typeof posts; teamPhotos?: TeamPhoto[] };
    posts = body.posts;
    if (!Array.isArray(posts)) throw new Error("no posts in the export");
    if (Array.isArray(body.teamPhotos)) team = body.teamPhotos.filter((t) => typeof t?.player === "string" && HEX16.test(t.imageId));
  } catch (err) {
    return { changed: false, problem: `coach posts: ${(err as Error).message}` };
  }

  mkdirSync(o.imgDir, { recursive: true });
  const ids = [...posts.flatMap((p) => [p.image?.id, p.data?.thumb?.imageId]), ...(team ?? []).map((t) => t.imageId)]
    .filter((id): id is string => typeof id === "string" && HEX16.test(id));
  for (const id of new Set(ids)) {
    const path = join(o.imgDir, `${id}.jpg`);
    if (existsSync(path)) continue;
    try {
      const res = await fetcher(`${site}/api/coach/images/${id}/`, { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      writeFileSync(path, new Uint8Array(await res.arrayBuffer()));
    } catch (err) {
      return { changed: false, problem: `coach photo ${id}: ${(err as Error).message}` };
    }
  }

  const postsChanged = writeIfChanged(o.file, JSON.stringify(posts, null, 1));
  const teamChanged = !!(o.teamFile && team) && writeIfChanged(o.teamFile, JSON.stringify(teamMap(team), null, 1));
  return { changed: postsChanged || teamChanged };
}

const HEX16 = /^[0-9a-f]{16}$/;

/** What the site builds with (src/lib/data.ts): player → the photo's path and size. */
export const teamMap = (team: TeamPhoto[]): TeamPhotoMap =>
  Object.fromEntries(team.map((t) => [t.player, { photo: imagePath(t.imageId), width: t.width, height: t.height }]));

function writeIfChanged(file: string, next: string): boolean {
  if (existsSync(file) && readFileSync(file, "utf8") === next) return false;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, next);
  return true;
}
