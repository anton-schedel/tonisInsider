import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import type { Snapshot } from "../../../../../scraper/snapshot.ts";
import type { EdgeCache } from "../../../../lib/comments.ts";
import { teamCenter } from "../../../../lib/kickbase.ts";
import type { ClubPoints } from "../../../../lib/livePoints.ts";
import { mapClubs, pointsByLigaInsiderId } from "../../../../lib/match.ts";
import { serviceTable, withService } from "../../../../lib/serviceKickbase.ts";

export const prerender = false;

/** Shared by every viewer: Kickbase is asked at most every 30 s per club (5 min once the match is over). */
const LIVE_TTL = 30;
const DONE_TTL = 300;

/** GET /api/kickbase/club/<LigaInsider slug>/: Kickbase points of that club's lineup players, by LigaInsider id. */
export const GET: APIRoute = async ({ params, url }) => {
  const slug = params.slug ?? "";
  if (!/^[a-z0-9-]{2,60}$/.test(slug)) return Response.json({ error: "Unbekannter Verein." }, { status: 404 });
  const cache = (globalThis as { caches?: { default?: EdgeCache } }).caches?.default;
  const key = `https://kickbase.cache/club/${slug}`;
  const hit = await cache?.match(key);
  if (hit) return hit;

  try {
    const snapshot = (await env.ASSETS.fetch(new URL("/data/snapshot.json", url)).then((r: Response) => r.json())) as Snapshot;
    const lineup = snapshot.lineups.find((l) => l.club.slug === slug);
    if (!lineup) return Response.json({ error: "Unbekannter Verein." }, { status: 404 });
    const body = await withService(async (token) => {
      const table = await serviceTable(token);
      const teamId = [...mapClubs(table, [lineup]).keys()][0];
      if (!teamId) return undefined;
      const center = await teamCenter(fetch, token, teamId);
      return { live: center.live, players: pointsByLigaInsiderId(lineup, center.players) } satisfies ClubPoints;
    });
    if (!body) return Response.json({ error: "Keine Kickbase-Daten." }, { status: 503, headers: { "cache-control": "no-store" } });
    const ttl = body.live.state === 2 ? DONE_TTL : LIVE_TTL;
    const res = Response.json(body, { headers: { "cache-control": `public, max-age=${ttl}` } });
    await cache?.put(key, res.clone());
    return res;
  } catch {
    return Response.json({ error: "Kickbase ist gerade nicht erreichbar." }, { status: 502, headers: { "cache-control": "no-store" } });
  }
};
