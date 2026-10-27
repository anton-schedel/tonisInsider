import { env, type D1 } from "cloudflare:workers";
import { isSameOrigin, type CookieJar } from "./session.ts";
import { modelFromEnv } from "./coachBots.ts";
import { COACH_COOKIE, isCoach } from "./coachAuth.ts";
import { json } from "./http.ts";

export { json };

export const coachSignedIn = (cookies: CookieJar) => isCoach(cookies.get(COACH_COOKIE)?.value, env.CREDENTIALS_KEY, Date.now());

/** The database for a coach request, or what to answer when it may not go on (writes from another site, no database, not signed in). */
export async function coachGuard(request: Request, cookies: CookieJar): Promise<D1 | Response> {
  if (request.method !== "GET" && request.method !== "HEAD" && !isSameOrigin(request)) return json({ error: "Nicht erlaubt." }, 403);
  const db = env.COMMENTS;
  if (!db) return json({ error: "Gerade nicht erreichbar." }, 503);
  if (!(await coachSignedIn(cookies))) return json(NOT_SIGNED_IN, 401);
  return db;
}

/** The scrape run's token (header x-export-token), compared in constant time. */
export function exportAllowed(request: Request): boolean {
  const given = request.headers.get("x-export-token") ?? "";
  const expected = env.COACH_EXPORT_TOKEN ?? "";
  if (!expected || given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

/** The LLM for bot comments, if set up. */
export const modelConfig = () => modelFromEnv(env);

export const NOT_SIGNED_IN = { error: "Bitte melde dich wieder an.", signedOut: true };
