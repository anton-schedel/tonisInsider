import type { AstroCookieSetOptions } from "astro";
import { KickbaseAuthError, type KbLogin } from "./kickbase.ts";
import { seal, unseal } from "./vault.ts";

/** Kickbase token. HttpOnly: page scripts can never read it. */
export const TOKEN_COOKIE = "kb";
/** Readable flag so the tab bar can say "Mein Team" vs "Login". Contains no secret. */
export const LOGGED_IN_COOKIE = "kbin";
/** Last chosen league id. */
export const LEAGUE_COOKIE = "kbleague";
/** Encrypted Kickbase email + password (AES-GCM, key only on the Worker) for automatic re-login. */
export const CREDENTIALS_COOKIE = "kbc";

/** Browsers cap cookie lifetime at 400 days. */
const LONG = 400 * 24 * 60 * 60;

/** The subset of Astro's cookie jar we use (keeps this module testable). */
export type CookieJar = {
  get(name: string): { value: string } | undefined;
  set(name: string, value: string, options?: AstroCookieSetOptions): void;
  delete(name: string, options?: { path?: string }): void;
};

/** CSRF guard for POST endpoints: the browser must send our own origin. */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return origin !== null && origin === new URL(request.url).origin;
}

/** Kickbase's token expiry; one day if it is missing or unparseable (never let a bad date break login). */
export function parseExpiry(tknex: string | undefined, now = Date.now()): Date {
  const d = new Date(tknex ?? "");
  return Number.isNaN(d.getTime()) ? new Date(now + 86_400_000) : d;
}

export function setSession(cookies: CookieJar, token: string, expires: Date): void {
  cookies.set(TOKEN_COOKIE, token, { httpOnly: true, secure: true, sameSite: "lax", path: "/", expires });
  cookies.set(LOGGED_IN_COOKIE, "1", { httpOnly: false, secure: true, sameSite: "lax", path: "/", maxAge: LONG });
}

/** Stores the credentials encrypted in the user's own browser — only if the Worker has a key. */
export async function rememberCredentials(cookies: CookieJar, key: string | undefined, email: string, password: string): Promise<void> {
  if (!key) return;
  const sealed = await seal(JSON.stringify({ e: email, p: password }), key);
  cookies.set(CREDENTIALS_COOKIE, sealed, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: LONG });
}

/**
 * Logs in again with the stored credentials. Returns the new token, or undefined if that is not possible
 * (no cookie, no key, undecryptable, or Kickbase rejects them — then the whole session is cleared).
 * KickbaseUnavailableError is rethrown so the page can say "Kickbase nicht erreichbar".
 */
export async function relogin(
  cookies: CookieJar,
  key: string | undefined,
  login: (email: string, password: string) => Promise<KbLogin>,
): Promise<string | undefined> {
  const sealed = cookies.get(CREDENTIALS_COOKIE)?.value;
  if (!sealed || !key) return undefined;
  const plain = await unseal(sealed, key);
  let creds: { e?: string; p?: string } | undefined;
  try { creds = plain ? JSON.parse(plain) : undefined; } catch { creds = undefined; }
  if (!creds?.e || !creds.p) {
    clearSession(cookies);
    return undefined;
  }
  try {
    const session = await login(creds.e, creds.p);
    setSession(cookies, session.token, parseExpiry(session.expires));
    return session.token;
  } catch (err) {
    if (err instanceof KickbaseAuthError) {
      clearSession(cookies);
      return undefined;
    }
    throw err;
  }
}

export function clearSession(cookies: CookieJar): void {
  for (const name of [TOKEN_COOKIE, LOGGED_IN_COOKIE, LEAGUE_COOKIE, CREDENTIALS_COOKIE]) cookies.delete(name, { path: "/" });
}
