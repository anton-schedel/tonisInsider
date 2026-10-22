import { unseal } from "./vault.ts";
import { CREDENTIALS_COOKIE, ligaCredentials, type CookieJar } from "./session.ts";

/** At most this many players on a scout list. */
export const SCOUT_MAX = 100;

/**
 * Whose scout list this is: the Kickbase account, else the LigaInsider account, from the encrypted login
 * cookies (a plain cookie could be forged). A hash of the email or username, never the name itself.
 * Undefined without a login: the list then lives in the browser only.
 */
export async function scoutOwner(cookies: CookieJar, key: string | undefined): Promise<string | undefined> {
  if (!key) return undefined;
  const sealed = cookies.get(CREDENTIALS_COOKIE)?.value;
  if (sealed) {
    try {
      const email = (JSON.parse((await unseal(sealed, key)) ?? "{}") as { e?: string }).e;
      if (email) return hash(`kb:${email.trim().toLowerCase()}`, key);
    } catch { /* fall through to LigaInsider */ }
  }
  const li = await ligaCredentials(cookies, key);
  return li ? hash(`li:${li.u.trim().toLowerCase()}`, key) : undefined;
}

async function hash(value: string, key: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${key}|${value}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Player ids from a request: positive integers only, no duplicates, at most SCOUT_MAX. */
export function playerIds(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const ids = value.filter((v): v is number => Number.isInteger(v) && v > 0 && v < 1_000_000_000);
  return [...new Set(ids)].slice(0, SCOUT_MAX);
}
