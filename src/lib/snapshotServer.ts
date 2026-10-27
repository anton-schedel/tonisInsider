import { env } from "cloudflare:workers";
import type { Snapshot } from "../../scraper/snapshot.ts";
import { BUILD_ID } from "./build.ts";

/** The deploy's snapshot never changes: parsed once per Worker isolate and build (read only). */
const g = globalThis as unknown as { __snapshot?: { build: string; data: Snapshot } };

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
