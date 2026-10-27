import type { APIRoute } from "astro";
import { USER_AGENT } from "../../../scraper/fetch.ts";
import { hedged } from "../../lib/comments.ts";
import { edgeCache, later } from "../../lib/http.ts";
import { loadSnapshot } from "../../lib/snapshotServer.ts";
import { espnUrls, LI_HOME_URL, mergeScores, parseEspn, parseLiScores, type LiScore } from "../../lib/live.ts";

export const prerender = false;

/** Shared by every viewer: the sources are asked at most every 30 s, however many have the page open. */
const TTL_SECONDS = 30;
const KEY = "https://live.cache/scores";

/**
 * GET /api/live/: scores and ends of the matchday's games. From LigaInsider's match bar; games it doesn't list
 * (its homepage sometimes has no match bar at all) come from ESPN's scoreboard.
 */
export const GET: APIRoute = async ({ url, locals }) => {
  const cache = edgeCache();
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
  if (games.length && cache) later(locals)(cache.put(KEY, res.clone()));
  return res;
};

/** ESPN's games, named by our club slugs (the clubs come from the site's own data). */
async function fromEspn(url: URL): Promise<LiScore[]> {
  const day = (u: string) => fetch(u, { signal: AbortSignal.timeout(5000) }).then((r) => (r.ok ? r.json() : undefined)).catch(() => undefined);
  const [days, snapshot] = await Promise.all([
    Promise.all(espnUrls(new Date()).map(day)),
    loadSnapshot(url),
  ]);
  if (days.every((d) => d === undefined)) throw new Error("ESPN unavailable");
  if (!snapshot) throw new Error("no snapshot");
  return parseEspn(days, snapshot.lineups.map((l) => ({ name: l.club.name, slug: l.club.slug })));
}
