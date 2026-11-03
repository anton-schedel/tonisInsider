import { describe, it, expect } from "vitest";
import { appTeam, myTeamData, type MyTeamResult } from "./myTeam.ts";
import { KB_NAME_COOKIE, KB_USER_ID_COOKIE, TOKEN_COOKIE } from "./session.ts";
import type { MyPlayer } from "./match.ts";

const KEY = Buffer.alloc(32, 7).toString("base64");

function jar(init: Record<string, string> = {}) {
  const store = new Map(Object.entries(init));
  return {
    store,
    get: (n: string) => (store.has(n) ? { value: store.get(n)! } : undefined),
    set: (n: string, v: string) => void store.set(n, v),
    delete: (n: string) => void store.delete(n),
  };
}
const none = async () => undefined;
const rejecting = (async () => new Response("{}", { status: 401 })) as typeof fetch;

const player = (id: string, position: 1 | 2 | 3 | 4): MyPlayer => ({
  kickbase: { id, name: `P${id}`, teamId: "2", position },
  status: "start",
});
const result = (players: MyPlayer[], starterCount: number, extra: Partial<MyTeamResult["data"]> = {}): MyTeamResult => ({
  data: {
    leagues: [{ id: "L1", name: "Liga" }], league: { id: "L1", name: "Liga" }, players, starterCount, points: 12,
    outlook: new Map(), cardNews: new Map(), summary: undefined, ...extra,
  } as MyTeamResult["data"],
});

describe("myTeamData", () => {
  it("signed out without a token or credentials", async () => {
    const r = await myTeamData({ cookies: jar(), key: KEY, fetch: rejecting, league: null, snapshot: none, history: none });
    expect(r.signedOut).toBe("none");
    expect(r.data.players).toEqual([]);
  });

  it("expired when Kickbase rejects and no credentials", async () => {
    const cookies = jar({ [TOKEN_COOKIE]: "old", [KB_NAME_COOKIE]: "Toni" });
    const r = await myTeamData({ cookies, key: KEY, fetch: rejecting, league: null, snapshot: none, history: none });
    expect(r.signedOut).toBe("expired");
    expect(cookies.store.has(TOKEN_COOKIE)).toBe(false);
    expect(cookies.store.has(KB_NAME_COOKIE)).toBe(false);
  });
});

describe("appTeam", () => {
  it("puts the XI on the pitch and the rest on the bench", () => {
    const t = appTeam(result([player("a", 1), player("b", 4), player("c", 2)], 2), jar(), Date.now());
    expect(t.lines.flat().sort()).toEqual(["a", "b"]);
    expect(t.bench).toEqual(["c"]);
    expect(t.formation).toBe("0-0-1");
    expect(t.players.c?.card.pos).toBe("ABW");
    expect(t.leagueId).toBe("L1");
    expect(t.points).toBe(12);
  });

  it("marks fresh news", () => {
    const fresh = { id: 1, title: "x", type: "verletzung" as const, at: new Date().toISOString() };
    const t = appTeam(result([player("a", 1)], 1, { cardNews: new Map([["a", [fresh]]]) }), jar(), Date.now());
    expect(t.players.a?.freshNews).toBe(true);
    expect(t.players.a?.card.news).toEqual([fresh]);
  });

  it("names the account from the readable cookies", () => {
    const t = appTeam(result([], 0), jar({ [KB_NAME_COOKIE]: "Toni", [KB_USER_ID_COOKIE]: "42" }), Date.now());
    expect(t.account).toEqual({ name: "Toni", userId: "42" });
  });

  it("passes signed out and errors on", () => {
    expect(appTeam({ ...result([], 0), signedOut: "none" }, jar(), Date.now()).signedOut).toBe("none");
    expect(appTeam({ ...result([], 0), error: "weg" }, jar(), Date.now()).error).toBe("weg");
  });
});
