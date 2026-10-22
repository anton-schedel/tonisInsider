import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * The coach's posts (/schnoeselmob/, stored in D1): fetched from the site's export each run into
 * store/coach-posts.json, with their photos in public/img/custom/coach/. A change (new, edited or deleted post)
 * means a rebuild; a failed fetch keeps the last posts.
 */
export async function pullCoachPosts(o: { site: string; token: string; file: string; imgDir: string; fetcher?: typeof fetch }): Promise<{ changed: boolean; problem?: string }> {
  const fetcher = o.fetcher ?? fetch;
  const site = o.site.replace(/\/+$/, "");
  const headers = { "x-export-token": o.token };
  let posts: { image?: { id: string } }[];
  try {
    const res = await fetcher(`${site}/api/coach/export/`, { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    posts = ((await res.json()) as { posts: typeof posts }).posts;
    if (!Array.isArray(posts)) throw new Error("no posts in the export");
  } catch (err) {
    return { changed: false, problem: `coach posts: ${(err as Error).message}` };
  }

  mkdirSync(o.imgDir, { recursive: true });
  for (const id of new Set(posts.flatMap((p) => (p.image && /^[0-9a-f]{16}$/.test(p.image.id) ? [p.image.id] : [])))) {
    const path = join(o.imgDir, `${id}.jpg`);
    if (existsSync(path)) continue;
    const res = await fetcher(`${site}/api/coach/images/${id}/`, { headers });
    if (!res.ok) return { changed: false, problem: `coach photo ${id}: HTTP ${res.status}` };
    writeFileSync(path, new Uint8Array(await res.arrayBuffer()));
  }

  const next = JSON.stringify(posts, null, 1);
  const before = existsSync(o.file) ? readFileSync(o.file, "utf8") : undefined;
  if (before === next) return { changed: false };
  mkdirSync(dirname(o.file), { recursive: true });
  writeFileSync(o.file, next);
  return { changed: true };
}
