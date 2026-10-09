import type { APIRoute } from "astro";
import { USER_AGENT } from "../../../scraper/fetch.ts";
import { hedged, type EdgeCache } from "../../lib/comments.ts";
import { LI_HOME_URL, parseLiScores } from "../../lib/live.ts";

export const prerender = false;

/** Shared by every viewer: LigaInsider is asked at most every 30 s, however many have the page open. */
const TTL_SECONDS = 30;
const KEY = "https://live.cache/scores";

/** GET /api/live/: scores and ends of the matchday's games from LigaInsider's match bar. */
export const GET: APIRoute = async () => {
  const cache = (globalThis as { caches?: { default?: EdgeCache } }).caches?.default;
  const hit = await cache?.match(KEY);
  if (hit) return hit;
  try {
    const games = await hedged(async (signal) => {
      const res = await fetch(LI_HOME_URL, { headers: { "user-agent": USER_AGENT, "accept-language": "de-DE,de;q=0.9" }, signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return parseLiScores(await res.text());
    });
    const res = Response.json(games, { headers: { "cache-control": `public, max-age=${TTL_SECONDS}` } });
    if (games.length) await cache?.put(KEY, res.clone());
    return res;
  } catch {
    return Response.json({ error: "unavailable" }, { status: 502, headers: { "cache-control": "no-store" } });
  }
};
