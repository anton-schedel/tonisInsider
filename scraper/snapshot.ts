import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { HttpError, type Fetcher } from "./fetch.ts";
import type { Store } from "./store.ts";
import type { Article, Lineup, State } from "./types.ts";
import { ensureImage } from "./images.ts";

export type Snapshot = { version: 1; articles: Article[]; lineups: Lineup[]; state: State };

export function writeSnapshot(store: Store, file: string): void {
  const snapshot: Snapshot = { version: 1, articles: store.articles(), lineups: store.lineups(), state: store.state() };
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(snapshot));
}

/** What the site's open pages poll to notice updates: the newest Bundesliga article and the last change. */
export type Version = { newest?: number; updated?: string };

export function newestArticleId(articles: Article[]): number | undefined {
  return articles
    .filter((a) => a.category === "bundesliga")
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))[0]?.id;
}

export function writeVersion(store: Store, file: string): void {
  const version: Version = { newest: newestArticleId(store.articles()), updated: store.state().lastChangeAt };
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(version));
}

/** Every local image path referenced by the data, e.g. "/img/players/9357.jpg". */
export function referencedImages(s: Pick<Snapshot, "articles" | "lineups">): string[] {
  const paths = new Set<string>();
  const add = (p?: string) => p && paths.add(p);
  for (const a of s.articles) { add(a.player?.photo); add(a.club?.crest); add(a.banner ?? undefined); }
  for (const l of s.lineups) {
    add(l.club.crest);
    for (const p of l.lines.flat()) { add(p.photo); add(p.alternative?.photo); }
  }
  return [...paths];
}

/**
 * Restores store/ and images from our own deployed site. Used when the Actions cache was evicted.
 * Returns false only if the site has no snapshot (404, e.g. very first deploy). Any other failure throws:
 * starting fresh after a temporary outage would deploy a tiny snapshot over 30 days of history.
 */
export async function restoreFromSite(store: Store, fetcher: Fetcher, siteUrl: string, publicDir: string): Promise<boolean> {
  let snapshot: Snapshot;
  try {
    snapshot = JSON.parse(await fetcher.text(`${siteUrl.replace(/\/$/, "")}/data/snapshot.json`)) as Snapshot;
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) {
      console.warn("no snapshot on site yet");
      return false;
    }
    throw err;
  }
  if (snapshot?.version !== 1 || !Array.isArray(snapshot.articles)) throw new Error("site returned an invalid snapshot");
  for (const a of snapshot.articles) store.putArticle(a);
  for (const l of snapshot.lineups) store.putLineup(l);
  store.putState(snapshot.state);
  for (const path of referencedImages(snapshot)) {
    const m = path.match(/^\/img\/(players|clubs|articles)\/([a-z0-9-]+)\.\w+$/);
    if (m) {
      const kind = m[1] as "players" | "clubs" | "articles";
      await ensureImage(fetcher, publicDir, kind, kind === "articles" ? m[2] : Number(m[2]), `${siteUrl.replace(/\/$/, "")}${path}`);
    }
  }
  return true;
}
