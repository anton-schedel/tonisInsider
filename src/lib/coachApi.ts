import { env } from "cloudflare:workers";
import type { CookieJar } from "./session.ts";
import { COACH_COOKIE, isCoach } from "./coachAuth.ts";

export const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "private, no-store" } });

export const coachSignedIn = (cookies: CookieJar) => isCoach(cookies.get(COACH_COOKIE)?.value, env.CREDENTIALS_KEY, Date.now());

/** The scrape run's token (header x-export-token), compared in constant time. */
export function exportAllowed(request: Request): boolean {
  const given = request.headers.get("x-export-token") ?? "";
  const expected = env.COACH_EXPORT_TOKEN ?? "";
  if (!expected || given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export const NOT_SIGNED_IN = { error: "Bitte melde dich wieder an.", signedOut: true };
