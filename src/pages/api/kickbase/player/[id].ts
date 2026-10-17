import type { APIRoute } from "astro";
import type { EdgeCache } from "../../../../lib/comments.ts";
import { eventTypes, playerCenter } from "../../../../lib/kickbase.ts";
import { summarize, type PlayerPoints } from "../../../../lib/livePoints.ts";
import { withService } from "../../../../lib/serviceKickbase.ts";

export const prerender = false;

/** Shared by every viewer: Kickbase is asked at most every 30 s per player (10 min once his match is over). */
const LIVE_TTL = 30;
const DONE_TTL = 600;

/** Event type names change with Kickbase's rules only: kept per Worker isolate for a day. */
const g = globalThis as unknown as { __kbEventTypes?: { at: number; names: Map<number, string> } };

/** GET /api/kickbase/player/<Kickbase id>/: his points on the current matchday and the actions behind them. */
export const GET: APIRoute = async ({ params }) => {
  const id = params.id ?? "";
  if (!/^\d{1,9}$/.test(id)) return Response.json({ error: "Unbekannter Spieler." }, { status: 404 });
  const cache = (globalThis as { caches?: { default?: EdgeCache } }).caches?.default;
  const key = `https://kickbase.cache/player/${id}`;
  const hit = await cache?.match(key);
  if (hit) return hit;
  try {
    const body = await withService(async (token) => {
      if (!g.__kbEventTypes || Date.now() - g.__kbEventTypes.at > 86_400_000) {
        const names = await eventTypes(fetch, token);
        if (names.size) g.__kbEventTypes = { at: Date.now(), names };
      }
      const { live, events } = await playerCenter(fetch, token, id);
      return { live, lines: summarize(events, g.__kbEventTypes?.names ?? new Map()) } satisfies PlayerPoints;
    });
    if (!body) return Response.json({ error: "Keine Kickbase-Daten." }, { status: 503, headers: { "cache-control": "no-store" } });
    const res = Response.json(body, { headers: { "cache-control": `public, max-age=${body.live.state === 2 ? DONE_TTL : LIVE_TTL}` } });
    await cache?.put(key, res.clone());
    return res;
  } catch {
    return Response.json({ error: "Kickbase ist gerade nicht erreichbar." }, { status: 502, headers: { "cache-control": "no-store" } });
  }
};
