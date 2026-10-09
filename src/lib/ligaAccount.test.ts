import { describe, it, expect } from "vitest";
import type { AstroCookieSetOptions } from "astro";
import { callLiga } from "./ligaAccount.ts";
import { LigaInsiderUnavailableError } from "./ligainsider.ts";
import { LI_SESSION_COOKIE, rememberLiga } from "./session.ts";

const KEY = Buffer.alloc(32, 7).toString("base64");

function jar() {
  const store = new Map<string, { value: string; opts?: AstroCookieSetOptions }>();
  return {
    store,
    get: (n: string) => (store.has(n) ? { value: store.get(n)!.value } : undefined),
    set: (n: string, v: string, opts?: AstroCookieSetOptions) => void store.set(n, { value: v, opts }),
    delete: (n: string) => void store.delete(n),
  };
}

/** LigaInsider's login, just enough for a renewed session cookie. */
const loginFetch = (async (url: string | URL | Request) => {
  const path = String(url);
  if (path.endsWith("/user/login/")) return new Response("", { status: 302, headers: { location: "/", "set-cookie": "li_at=fresh; Path=/" } });
  if (path.endsWith("/login/")) return new Response("", { status: 200, headers: { "set-cookie": "PHPSESSID=abc; Path=/" } });
  throw new Error(`unexpected ${path}`);
}) as typeof fetch;

describe("callLiga", () => {
  it("logs in again when the stored session's write comes back as a gateway 502", async () => {
    const cookies = jar();
    await rememberLiga(cookies, KEY, "Anton", "geheim");
    cookies.set(LI_SESSION_COOKIE, "li_at=stale");
    const seen: string[] = [];
    const result = await callLiga(cookies, KEY, loginFetch, async (session) => {
      seen.push(session.cookie);
      if (session.cookie.includes("stale")) throw new LigaInsiderUnavailableError("post HTTP 502 error code: 502");
      return "ok";
    });
    expect(result).toBe("ok");
    expect(seen).toEqual(["li_at=stale", "PHPSESSID=abc; li_at=fresh"]);
  });

  it("does not log in again for a different failure", async () => {
    const cookies = jar();
    await rememberLiga(cookies, KEY, "Anton", "geheim");
    cookies.set(LI_SESSION_COOKIE, "li_at=stale");
    await expect(callLiga(cookies, KEY, loginFetch, async () => {
      throw new LigaInsiderUnavailableError("network error or timeout");
    })).rejects.toThrow(/network error or timeout/);
    expect(cookies.get(LI_SESSION_COOKIE)?.value).toBe("li_at=stale");
  });
});
