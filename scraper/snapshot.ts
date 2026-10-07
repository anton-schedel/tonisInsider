import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Fetcher } from "./fetch.ts";
import type { Store } from "./store.ts";
import type { Article, Lineup, State } from "./types.ts";
import { ensureImage } from "./images.ts";

export type Snapshot = { version: 1; articles: Article[]; lineups: Lineup[]; state: State };

export function writeSnapshot(store: Store, file: string): void {
  const snapshot: Snapshot = { version: 1, articles: store.articles(), lineups: store.lineups(), state: store.state() };
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(snapshot));
}

/** Every local image path referenced by the data, e.g. "/img/players/9357.jpg". */
export function referencedImages(s: Pick<Snapshot, "articles" | "lineups">): string[] {
  const paths = new Set<string>();
  const add = (p?: string) => p && paths.add(p);
  for (const a of s.articles) { add(a.player?.photo); add(a.club?.crest); }
  for (const l of s.lineups) {
    add(l.club.crest);
    for (const p of l.lines.flat()) { add(p.photo); add(p.alternative?.photo); }
  }
  return [...paths];
}

/**
 * Restores store/ and images from our own deployed site. Used when the Actions cache was evicted.
 * Returns false if the site has no snapshot (e.g. very first deploy).
 */
export async function restoreFromSite(store: Store, fetcher: Fetcher, siteUrl: string, publicDir: string): Promise<boolean> {
  let snapshot: Snapshot;
  try {
    snapshot = JSON.parse(await fetcher.text(`${siteUrl.replace(/\/$/, "")}/data/snapshot.json`)) as Snapshot;
  } catch (err) {
    console.warn(`no snapshot on site: ${(err as Error).message}`);
    return false;
  }
  for (const a of snapshot.articles) store.putArticle(a);
  for (const l of snapshot.lineups) store.putLineup(l);
  store.putState(snapshot.state);
  for (const path of referencedImages(snapshot)) {
    const m = path.match(/^\/img\/(players|clubs)\/(\d+)\.\w+$/);
    if (m) await ensureImage(fetcher, publicDir, m[1] as "players" | "clubs", Number(m[2]), `${siteUrl.replace(/\/$/, "")}${path}`);
  }
  return true;
}
