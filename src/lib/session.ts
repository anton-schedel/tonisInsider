import type { AstroCookies } from "astro";

/** Kickbase token. HttpOnly: page scripts can never read it. */
export const TOKEN_COOKIE = "kb";
/** Readable flag so the tab bar can say "Mein Team" vs "Login". Contains no secret. */
export const LOGGED_IN_COOKIE = "kbin";
/** Last chosen league id. */
export const LEAGUE_COOKIE = "kbleague";

/** CSRF guard for POST endpoints: the browser must send our own origin. */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return origin !== null && origin === new URL(request.url).origin;
}

export function setSession(cookies: AstroCookies, token: string, expires: Date): void {
  cookies.set(TOKEN_COOKIE, token, { httpOnly: true, secure: true, sameSite: "lax", path: "/", expires });
  cookies.set(LOGGED_IN_COOKIE, "1", { httpOnly: false, secure: true, sameSite: "lax", path: "/", expires });
}

export function clearSession(cookies: AstroCookies): void {
  for (const name of [TOKEN_COOKIE, LOGGED_IN_COOKIE, LEAGUE_COOKIE]) cookies.delete(name, { path: "/" });
}
