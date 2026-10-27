import type { APIRoute } from "astro";
import { later } from "../../../../lib/http.ts";
import { eventTypes, playerCenter } from "../../../../lib/kickbase.ts";
import { summarize, type PlayerPoints } from "../../../../lib/livePoints.ts";
import { sharedKickbase, withService } from "../../../../lib/serviceKickbase.ts";

export const prerender = false;

/** Shared by every viewer: Kickbase is asked at most every 30 s per player (10 min once his match is over). */
const LIVE_TTL = 30;
const DONE_TTL = 600;

/** Event type names change with Kickbase's rules only: kept per Worker isolate for a day. */
const g = globalThis as unknown as { __kbEventTypes?: { at: number; names: Map<number, string> } };

/** GET /api/kickbase/player/<Kickbase id>/: his points on the current matchday and the actions behind them. */
export const GET: APIRoute = async ({ params, locals }) => {
  const id = params.id ?? "";
  if (!/^\d{1,9}$/.test(id)) return Response.json({ error: "Unbekannter Spieler." }, { status: 404 });
  return sharedKickbase(`https://kickbase.cache/player/${id}`, later(locals), (body) => (body.live.state === 2 ? DONE_TTL : LIVE_TTL), () =>
    withService(async (token) => {
      if (!g.__kbEventTypes || Date.now() - g.__kbEventTypes.at > 86_400_000) {
        const names = await eventTypes(fetch, token);
        if (names.size) g.__kbEventTypes = { at: Date.now(), names };
      }
      const { live, events } = await playerCenter(fetch, token, id);
      return { live, lines: summarize(events, g.__kbEventTypes?.names ?? new Map()) } satisfies PlayerPoints;
    }));
};
