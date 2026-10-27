import { env } from "cloudflare:workers";
import { clubTable, KickbaseAuthError, login, type KbTeam } from "./kickbase.ts";
import { edgeCache, type Later } from "./http.ts";

/**
 * The site's own Kickbase session (KICKBASE_EMAIL / KICKBASE_PASSWORD secrets), for data that is the same for
 * everyone: live points on the club pages. Kept per Worker isolate until shortly before it expires.
 */
const g = globalThis as unknown as { __kbService?: { token: string; until: number }; __kbServiceTable?: { at: number; teams: KbTeam[] } };

export async function serviceToken(fresh = false): Promise<string | undefined> {
  if (!env.KICKBASE_EMAIL || !env.KICKBASE_PASSWORD) return undefined;
  if (!fresh && g.__kbService && g.__kbService.until > Date.now()) return g.__kbService.token;
  const s = await login(fetch, env.KICKBASE_EMAIL, env.KICKBASE_PASSWORD);
  const expires = Date.parse(s.expires);
  g.__kbService = { token: s.token, until: (Number.isNaN(expires) ? Date.now() + 86_400_000 : expires) - 3_600_000 };
  return s.token;
}

/** Runs a Kickbase call with the site's session; logs in again once if Kickbase says it expired. */
export async function withService<T>(run: (token: string) => Promise<T>): Promise<T | undefined> {
  const token = await serviceToken();
  if (!token) return undefined;
  try {
    return await run(token);
  } catch (err) {
    if (!(err instanceof KickbaseAuthError)) throw err;
    const again = await serviceToken(true);
    return again ? run(again) : undefined;
  }
}

/** The Bundesliga clubs with their Kickbase ids (for matching LigaInsider clubs), cached for a day. */
export async function serviceTable(token: string): Promise<KbTeam[]> {
  if (g.__kbServiceTable && Date.now() - g.__kbServiceTable.at < 86_400_000) return g.__kbServiceTable.teams;
  const teams = await clubTable(fetch, token);
  if (teams.length) g.__kbServiceTable = { at: Date.now(), teams };
  return teams;
}

/**
 * Shared JSON for every viewer, cached at the edge for ttl(body) seconds: compute() runs on a miss. It may answer
 * with its own Response (not cached); no body is a 503, a failure a 502.
 */
export async function sharedKickbase<T>(
  key: string, later: Later, ttl: (body: T) => number, compute: () => Promise<T | Response | undefined>,
): Promise<Response> {
  const cache = edgeCache();
  const hit = await cache?.match(key);
  if (hit) return hit;
  try {
    const body = await compute();
    if (body instanceof Response) return body;
    if (!body) return Response.json({ error: "Keine Kickbase-Daten." }, { status: 503, headers: { "cache-control": "no-store" } });
    const res = Response.json(body, { headers: { "cache-control": `public, max-age=${ttl(body)}` } });
    if (cache) later(cache.put(key, res.clone()));
    return res;
  } catch {
    return Response.json({ error: "Kickbase ist gerade nicht erreichbar." }, { status: 502, headers: { "cache-control": "no-store" } });
  }
}
