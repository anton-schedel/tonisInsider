import { describe, it, expect } from "vitest";
import { clubTable, KickbaseAuthError, KickbaseUnavailableError, leagues, login, squad } from "./kickbase.ts";

type Call = { url: string; init: RequestInit };

function fakeFetch(status: number, body: unknown) {
  const calls: Call[] = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  }) as typeof fetch;
  return { fn, calls };
}

describe("kickbase client", () => {
  it("logs in with em/pass and returns token, expiry and user id", async () => {
    const { fn, calls } = fakeFetch(200, { tkn: "T", tknex: "2026-10-14T10:00:00Z", u: { id: "42" } });
    expect(await login(fn, "a@b.de", "pw")).toEqual({ token: "T", expires: "2026-10-14T10:00:00Z", userId: "42" });
    expect(calls[0].url).toBe("https://api.kickbase.com/v4/user/login");
    expect(calls[0].init.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({ em: "a@b.de", pass: "pw" });
  });

  it("throws KickbaseAuthError on 401 (wrong password or expired token)", async () => {
    await expect(login(fakeFetch(401, { err: 1 }).fn, "a", "b")).rejects.toBeInstanceOf(KickbaseAuthError);
    await expect(leagues(fakeFetch(401, {}).fn, "T")).rejects.toBeInstanceOf(KickbaseAuthError);
  });

  it("throws KickbaseUnavailableError on 5xx, invalid JSON or network failure", async () => {
    await expect(leagues(fakeFetch(503, {}).fn, "T")).rejects.toBeInstanceOf(KickbaseUnavailableError);
    await expect(leagues(fakeFetch(200, "<html>").fn, "T")).rejects.toBeInstanceOf(KickbaseUnavailableError);
    const broken = (async () => { throw new TypeError("fetch failed"); }) as typeof fetch;
    await expect(leagues(broken, "T")).rejects.toBeInstanceOf(KickbaseUnavailableError);
  });

  it("sends the token as Bearer and maps leagues, squad and table", async () => {
    const l = fakeFetch(200, { it: [{ i: "7", n: "Liga" }] });
    expect(await leagues(l.fn, "T")).toEqual([{ id: "7", name: "Liga" }]);
    expect((l.calls[0].init.headers as Record<string, string>).authorization).toBe("Bearer T");

    const s = fakeFetch(200, { it: [{ i: "118", n: "Grifo", tid: "5", pos: 3, pim: "content/file/x.png" }] });
    expect(await squad(s.fn, "T", "7")).toEqual([
      { id: "118", name: "Grifo", teamId: "5", position: 3, image: "https://kickbase.b-cdn.net/content/file/x.png" },
    ]);
    expect(s.calls[0].url).toBe("https://api.kickbase.com/v4/leagues/7/squad");

    const t = fakeFetch(200, { it: [{ tid: "3", tn: "Dortmund" }] });
    expect(await clubTable(t.fn, "T")).toEqual([{ id: "3", name: "Dortmund" }]);
  });
});
