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
/** LigaInsider session cookies (HttpOnly). Same idea as the Kickbase token. */
export const LI_SESSION_COOKIE = "lis";
/** Encrypted LigaInsider username + password, so a dead session can be renewed. */
export const LI_CREDENTIALS_COOKIE = "lic";
/** Readable flag so the comment box knows someone is logged in. Contains no secret. */
export const LI_LOGGED_IN_COOKIE = "liin";
/** Readable display name. */
export const LI_NAME_COOKIE = "lin";

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

const liCookies = [LI_SESSION_COOKIE, LI_CREDENTIALS_COOKIE, LI_LOGGED_IN_COOKIE, LI_NAME_COOKIE];

/** Only a same-site path. Anything else goes to the front page (no open redirect). */
export function safeNext(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\") || value.includes("://")) return "/";
  return value;
}

export function setLigaSession(cookies: CookieJar, cookieHeader: string, username: string): void {
  cookies.set(LI_SESSION_COOKIE, cookieHeader, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: LONG });
  cookies.set(LI_LOGGED_IN_COOKIE, "1", { httpOnly: false, secure: true, sameSite: "lax", path: "/", maxAge: LONG });
  cookies.set(LI_NAME_COOKIE, encodeURIComponent(username), { httpOnly: false, secure: true, sameSite: "lax", path: "/", maxAge: LONG });
}

export async function rememberLiga(cookies: CookieJar, key: string | undefined, username: string, password: string): Promise<void> {
  if (!key) return;
  const sealed = await seal(JSON.stringify({ u: username, p: password }), key);
  cookies.set(LI_CREDENTIALS_COOKIE, sealed, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: LONG });
}

export type LigaCreds = { u: string; p: string };

/** Stored LigaInsider username and password, or undefined when there is nothing usable. */
export async function ligaCredentials(cookies: CookieJar, key: string | undefined): Promise<LigaCreds | undefined> {
  const sealed = cookies.get(LI_CREDENTIALS_COOKIE)?.value;
  if (!sealed || !key) return undefined;
  const plain = await unseal(sealed, key);
  let creds: LigaCreds | undefined;
  try { creds = plain ? JSON.parse(plain) : undefined; } catch { creds = undefined; }
  return creds?.u && creds.p ? creds : undefined;
}

export function clearLigaSession(cookies: CookieJar): void {
  for (const name of liCookies) cookies.delete(name, { path: "/" });
}
