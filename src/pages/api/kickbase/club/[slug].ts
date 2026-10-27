import type { APIRoute } from "astro";
import { later } from "../../../../lib/http.ts";
import { matchDetails, teamCenter } from "../../../../lib/kickbase.ts";
import type { ClubPoints } from "../../../../lib/livePoints.ts";
import { mapClubs, pointsByLigaInsiderId, slotPlays } from "../../../../lib/match.ts";
import { serviceTable, sharedKickbase, withService } from "../../../../lib/serviceKickbase.ts";
import { loadSnapshot } from "../../../../lib/snapshotServer.ts";

export const prerender = false;

/** Shared by every viewer: Kickbase is asked at most every 30 s per club (5 min once the match is over). */
const LIVE_TTL = 30;
const DONE_TTL = 300;

const unknownClub = () => Response.json({ error: "Unbekannter Verein." }, { status: 404 });

/** GET /api/kickbase/club/<LigaInsider slug>/: Kickbase points of that club's lineup players, by LigaInsider id. */
export const GET: APIRoute = async ({ params, url, locals }) => {
  const slug = params.slug ?? "";
  if (!/^[a-z0-9-]{2,60}$/.test(slug)) return unknownClub();
  return sharedKickbase(`https://kickbase.cache/club/${slug}`, later(locals), (body: ClubPoints) => (body.live.state === 2 ? DONE_TTL : LIVE_TTL), async () => {
    // The snapshot loads while Kickbase is asked for its clubs.
    const snapshot = loadSnapshot(url);
    return withService(async (token) => {
      const [s, table] = await Promise.all([snapshot, serviceTable(token)]);
      if (!s) throw new Error("no snapshot");
      const club = s.lineups.find((l) => l.club.slug === slug);
      if (!club) return unknownClub();
      const teamId = [...mapClubs(table, [club]).keys()][0];
      if (!teamId) return undefined;
      const center = await teamCenter(fetch, token, teamId);
      const { points, ids } = pointsByLigaInsiderId(club, center.players);
      // From kickoff: who really started in each slot, and who came on.
      let slots: ClubPoints["slots"];
      if (center.live.state > 0 && center.matchId) {
        const details = await matchDetails(fetch, token, center.matchId).catch(() => undefined);
        const starters = details?.starters[teamId];
        if (details && starters?.length) {
          slots = slotPlays(club, starters, details.subs.filter((x) => x.teamId === teamId), center.players);
        }
      }
      return { live: center.live, players: points, ids, ...(slots ? { slots } : {}) } satisfies ClubPoints;
    });
  });
};
