import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { appTeam, myTeamData } from "../../../lib/myTeam.ts";
import { loadSnapshot } from "../../../lib/snapshotServer.ts";
import { loadKbHistory } from "../../../lib/kbHistoryServer.ts";
import { json } from "../../../lib/http.ts";

export const prerender = false;

/** GET /api/app/my-team/?league=…: Mein Team for the iOS app (src/lib/myTeam.ts), the same data as the page. */
export const GET: APIRoute = async ({ url, cookies }) => {
  const result = await myTeamData({
    cookies, key: env.CREDENTIALS_KEY, fetch, league: url.searchParams.get("league"),
    snapshot: () => loadSnapshot(url), history: () => loadKbHistory(url),
  });
  return json(appTeam(result, cookies, Date.now()));
};
