import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { KickbaseAuthError, login, myEleven, type KbLive } from "../../../lib/kickbase.ts";
import { relogin, TOKEN_COOKIE } from "../../../lib/session.ts";
import { json } from "../../../lib/http.ts";

export const prerender = false;

/**
 * GET /api/kickbase/live/?league=<id>: the logged-in manager's live Kickbase points (XI total and per player),
 * polled by Mein Team while a match runs.
 */
export const GET: APIRoute = async ({ url, cookies }) => {
  const league = url.searchParams.get("league");
  if (!league || !/^\d{1,12}$/.test(league)) return json({ error: "league fehlt" }, 400);
  const doLogin = (email: string, password: string) => login(fetch, email, password);
  const read = async (token: string) => {
    const { starters, bench, points } = await myEleven(fetch, token, league);
    const players: Record<string, KbLive> = {};
    for (const p of [...starters, ...bench]) if (p.live) players[p.id] = p.live;
    return { points, players };
  };
  try {
    let token = cookies.get(TOKEN_COOKIE)?.value ?? (await relogin(cookies, env.CREDENTIALS_KEY, doLogin));
    if (!token) return json({ error: "Nicht angemeldet." }, 401);
    try {
      return json(await read(token));
    } catch (err) {
      if (!(err instanceof KickbaseAuthError)) throw err;
      token = await relogin(cookies, env.CREDENTIALS_KEY, doLogin);
      if (!token) return json({ error: "Nicht angemeldet." }, 401);
      return json(await read(token));
    }
  } catch (err) {
    if (err instanceof KickbaseAuthError) return json({ error: "Nicht angemeldet." }, 401);
    return json({ error: "Kickbase ist gerade nicht erreichbar." }, 502);
  }
};
