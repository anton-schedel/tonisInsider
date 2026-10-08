import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Fetcher } from "./fetch.ts";

/**
 * Downloads an image once and returns its public path (e.g. "/img/players/9357.jpg").
 * Returns undefined when there is no URL or the download fails (the UI falls back to initials).
 */
export async function ensureImage(
  fetcher: Fetcher,
  publicDir: string,
  kind: "players" | "clubs" | "articles",
  id: number | string,
  url: string | undefined,
): Promise<string | undefined> {
  if (!url) return undefined;
  const ext = url.split("?")[0].toLowerCase().endsWith(".png") ? "png" : "jpg";
  const publicPath = `/img/${kind}/${id}.${ext}`;
  const file = join(publicDir, publicPath);
  if (existsSync(file)) return publicPath;
  try {
    const bytes = await fetcher.binary(url);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, bytes);
    return publicPath;
  } catch (err) {
    console.warn(`image download failed: ${url}: ${(err as Error).message}`);
    return undefined;
  }
}

/**
 * File name for an article banner: the photo's own file name (+ its version), so the many articles that
 * reuse a player's photo share one download. Only a–z, 0–9 and dashes.
 */
export function bannerKey(url: string): string {
  const [path, query = ""] = url.split("?");
  const base = (path.split("/").pop() ?? "").replace(/\.[a-z]+$/i, "");
  const version = /updatedAt=(\d+)/.exec(query)?.[1];
  const safe = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return [safe(base), version].filter(Boolean).join("-");
}
