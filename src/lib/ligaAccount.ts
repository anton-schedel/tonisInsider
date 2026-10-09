import {
  LigaInsiderAuthError,
  LigaInsiderUnavailableError,
  login,
  type LiSession,
} from "./ligainsider.ts";
import {
  clearLigaSession,
  LI_SESSION_COOKIE,
  ligaCredentials,
  setLigaSession,
  type CookieJar,
} from "./session.ts";

async function renew(cookies: CookieJar, key: string | undefined, fetchFn: typeof fetch): Promise<LiSession | undefined> {
  const creds = await ligaCredentials(cookies, key);
  if (!creds) return undefined;
  try {
    const session = await login(fetchFn, creds.u, creds.p);
    setLigaSession(cookies, session.cookie, creds.u);
    return session;
  } catch (err) {
    if (err instanceof LigaInsiderAuthError) {
      clearLigaSession(cookies);
      return undefined;
    }
    throw err;
  }
}

/** The stored LigaInsider session, logging in again from the encrypted cookie when there is none. */
export async function currentLiga(cookies: CookieJar, key: string | undefined, fetchFn: typeof fetch): Promise<LiSession | undefined> {
  const existing = cookies.get(LI_SESSION_COOKIE)?.value;
  if (existing) return { cookie: existing };
  return renew(cookies, key, fetchFn);
}

/**
 * Runs `run` with a LigaInsider session. A dead session is renewed once from the stored
 * password; a wrong password clears the login.
 */
export async function callLiga<T>(
  cookies: CookieJar,
  key: string | undefined,
  fetchFn: typeof fetch,
  run: (session: LiSession) => Promise<T>,
): Promise<T> {
  const session = await currentLiga(cookies, key, fetchFn);
  if (!session) throw new LigaInsiderAuthError("no session");
  try {
    return await run(session);
  } catch (err) {
    // A stored session whose write comes back as a gateway 502 is not revived by
    // repeating that same cookie. A fresh login is, so try that once.
    const gateway = err instanceof LigaInsiderUnavailableError && /post HTTP 50[234]/.test(err.message);
    if (!(err instanceof LigaInsiderAuthError) && !gateway) throw err;
    cookies.delete(LI_SESSION_COOKIE, { path: "/" });
    const fresh = await renew(cookies, key, fetchFn);
    if (!fresh) throw err instanceof LigaInsiderAuthError ? new LigaInsiderAuthError("no session") : err;
    return run(fresh);
  }
}
