import { env } from "cloudflare:workers";
import type { Snapshot } from "../../scraper/snapshot.ts";
import type { AppFeed } from "./appFeed.ts";
import { BUILD_ID } from "./build.ts";

/** The deploy's snapshot never changes: parsed once per Worker isolate and build (read only). */
const g = globalThis as unknown as { __snapshot?: { build: string; data: Snapshot }; __appFeed?: { build: string; data: AppFeed } };

/** The site's data (/data/snapshot.json from the static assets); undefined if it can't be read. */
export async function loadSnapshot(url: URL): Promise<Snapshot | undefined> {
  if (g.__snapshot?.build === BUILD_ID) return g.__snapshot.data;
  try {
    const res = await env.ASSETS.fetch(new URL("/data/snapshot.json", url));
    if (!res.ok) return undefined;
    const data = (await res.json()) as Snapshot;
    g.__snapshot = { build: BUILD_ID, data };
    return data;
  } catch {
    return undefined;
  }
}

/** The deploy's app feed (/data/app-feed.json: articles, our own posts, lineups), parsed once per isolate and build. */
export async function loadAppFeed(url: URL): Promise<AppFeed | undefined> {
  if (g.__appFeed?.build === BUILD_ID) return g.__appFeed.data;
  try {
    const res = await env.ASSETS.fetch(new URL("/data/app-feed.json", url));
    if (!res.ok) return undefined;
    const data = (await res.json()) as AppFeed;
    g.__appFeed = { build: BUILD_ID, data };
    return data;
  } catch {
    return undefined;
  }
}
