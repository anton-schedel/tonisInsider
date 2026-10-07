import { describe, it, expect } from "vitest";
import type { AstroCookieSetOptions } from "astro";
import { CREDENTIALS_COOKIE, isSameOrigin, LOGGED_IN_COOKIE, parseExpiry, relogin, rememberCredentials, setSession, TOKEN_COOKIE } from "./session.ts";
import { KickbaseUnavailableError } from "./kickbase.ts";

const KEY = Buffer.alloc(32, 7).toString("base64");

/** Minimal stand-in for Astro's cookie jar. */
function jar() {
  const store = new Map<string, { value: string; opts?: AstroCookieSetOptions }>();
  return {
    store,
    get: (n: string) => (store.has(n) ? { value: store.get(n)!.value } : undefined),
    set: (n: string, v: string, opts?: AstroCookieSetOptions) => void store.set(n, { value: v, opts }),
    delete: (n: string) => void store.delete(n),
  };
}

const req = (origin?: string) =>
  new Request("https://ti.example/api/login/", { method: "POST", headers: origin ? { origin } : {} });

describe("isSameOrigin (CSRF guard)", () => {
  it("accepts our own origin", () => expect(isSameOrigin(req("https://ti.example"))).toBe(true));
  it("rejects a foreign origin", () => expect(isSameOrigin(req("https://evil.example"))).toBe(false));
  it("rejects a missing or null origin", () => {
    expect(isSameOrigin(req())).toBe(false);
    expect(isSameOrigin(req("null"))).toBe(false);
  });
});

describe("cookies", () => {
  it("sets the token HttpOnly/Secure/Lax until Kickbase's expiry", () => {
    const c = jar();
    const exp = new Date("2026-10-14T10:00:00Z");
    setSession(c, "T", exp);
    expect(c.store.get(TOKEN_COOKIE)).toEqual({ value: "T", opts: { httpOnly: true, secure: true, sameSite: "lax", path: "/", expires: exp } });
    expect(c.store.get(LOGGED_IN_COOKIE)?.opts).toMatchObject({ httpOnly: false, secure: true });
  });

  it("falls back to one day when Kickbase sends an unparseable expiry", () => {
    const now = Date.parse("2026-10-07T10:00:00Z");
    expect(parseExpiry("garbage", now).toISOString()).toBe("2026-10-08T10:00:00.000Z");
    expect(parseExpiry("2026-10-14T10:00:00Z", now).toISOString()).toBe("2026-10-14T10:00:00.000Z");
  });

  it("stores credentials only encrypted and only when a key is configured", async () => {
    const c = jar();
    await rememberCredentials(c, undefined, "a@b.de", "pw");
    expect(c.store.has(CREDENTIALS_COOKIE)).toBe(false);
    await rememberCredentials(c, KEY, "a@b.de", "pw");
    const kbc = c.store.get(CREDENTIALS_COOKIE)!;
    expect(kbc.value).not.toContain("a@b.de");
    expect(kbc.value).not.toContain("pw");
    expect(kbc.opts).toMatchObject({ httpOnly: true, secure: true, sameSite: "lax", path: "/" });
  });
});

describe("relogin", () => {
  it("logs in again with the stored credentials and refreshes the token cookie", async () => {
    const c = jar();
    await rememberCredentials(c, KEY, "a@b.de", "pw");
    const seen: unknown[] = [];
    const login = async (email: string, password: string) => {
      seen.push([email, password]);
      return { token: "NEW", expires: "2026-10-14T10:00:00Z", userId: "1" };
    };
    expect(await relogin(c, KEY, login)).toBe("NEW");
    expect(seen).toEqual([["a@b.de", "pw"]]);
    expect(c.store.get(TOKEN_COOKIE)?.value).toBe("NEW");
  });

  it("returns undefined without credentials, without key, or with a changed password (and clears the session)", async () => {
    const login = async () => { throw new (await import("./kickbase.ts")).KickbaseAuthError("401"); };
    expect(await relogin(jar(), KEY, login)).toBeUndefined();
    const c = jar();
    await rememberCredentials(c, KEY, "a@b.de", "old");
    expect(await relogin(c, undefined, login)).toBeUndefined();
    expect(await relogin(c, KEY, login)).toBeUndefined();
    expect(c.store.has(CREDENTIALS_COOKIE)).toBe(false);
  });

  it("lets 'Kickbase unavailable' through so the page can show it", async () => {
    const c = jar();
    await rememberCredentials(c, KEY, "a@b.de", "pw");
    const login = async () => { throw new KickbaseUnavailableError("503"); };
    await expect(relogin(c, KEY, login)).rejects.toBeInstanceOf(KickbaseUnavailableError);
    expect(c.store.has(CREDENTIALS_COOKIE)).toBe(true);
  });
});
