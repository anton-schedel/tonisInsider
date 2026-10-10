import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { USER_AGENT } from "../../../scraper/fetch.ts";
import type { Snapshot } from "../../../scraper/snapshot.ts";
import { hedged, type EdgeCache } from "../../lib/comments.ts";
import { espnUrl, LI_HOME_URL, mergeScores, parseEspn, parseLiScores, type LiScore } from "../../lib/live.ts";

export const prerender = false;

/** Shared by every viewer: the sources are asked at most every 30 s, however many have the page open. */
const TTL_SECONDS = 30;
const KEY = "https://live.cache/scores";

/**
 * GET /api/live/: scores and ends of the matchday's games. From LigaInsider's match bar; games it doesn't list
 * (its homepage sometimes has no match bar at all) come from ESPN's scoreboard.
 */
export const GET: APIRoute = async ({ url }) => {
  const cache = (globalThis as { caches?: { default?: EdgeCache } }).caches?.default;
  const hit = await cache?.match(KEY);
  if (hit) return hit;
  const [li, espn] = await Promise.allSettled([
    hedged(async (signal) => {
      const res = await fetch(LI_HOME_URL, { headers: { "user-agent": USER_AGENT, "accept-language": "de-DE,de;q=0.9" }, signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return parseLiScores(await res.text());
    }),
    fromEspn(url),
  ]);
  if (li.status === "rejected" && espn.status === "rejected") {
    return Response.json({ error: "unavailable" }, { status: 502, headers: { "cache-control": "no-store" } });
  }
  const games = mergeScores(li.status === "fulfilled" ? li.value : [], espn.status === "fulfilled" ? espn.value : []);
  const res = Response.json(games, { headers: { "cache-control": `public, max-age=${TTL_SECONDS}` } });
  if (games.length) await cache?.put(KEY, res.clone());
  return res;
};

/** ESPN's games, named by our club slugs (the clubs come from the site's own data). */
async function fromEspn(url: URL): Promise<LiScore[]> {
  const [scores, snapshot] = await Promise.all([
    fetch(espnUrl(new Date()), { signal: AbortSignal.timeout(5000) }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))),
    env.ASSETS.fetch(new URL("/data/snapshot.json", url)).then((r: Response) => r.json() as Promise<Snapshot>),
  ]);
  return parseEspn(scores, snapshot.lineups.map((l) => ({ name: l.club.name, slug: l.club.slug })));
}
