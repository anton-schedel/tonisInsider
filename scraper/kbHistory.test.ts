import { describe, expect, it } from "vitest";
import { emptyHistory, gameOf, historyDue, loadHistory, updateHistory, type HistoryApi, type KbHistory } from "./kbHistory.ts";
import type { KbPerfMatch } from "../src/lib/kickbase.ts";

const NOW = new Date("2026-11-02T12:00:00.000Z");
const match = (day: number, extra: Partial<KbPerfMatch> = {}): KbPerfMatch => ({
  day, matchId: `m${day}`, date: `2026-10-0${day}T13:30:00Z`, home: "2", away: "3", homeGoals: 2, awayGoals: 1,
  points: 100, minutes: 90, state: 2, team: "2", ...extra,
});

/** A fake Kickbase: two clubs, one player each; counts the requests. */
function fakeApi(perf: Record<string, KbPerfMatch[]>, played = 2, season = "2026/2027") {
  const calls: string[] = [];
  const api: HistoryApi = {
    table: async () => { calls.push("table"); return [{ id: "2", name: "Bayern", played }, { id: "3", name: "BVB", played }]; },
    squad: async (tid) => { calls.push(`squad ${tid}`); return tid === "2" ? [{ id: "10", name: "Kane", position: 4 }] : [{ id: "20", name: "Kobel", position: 1 }]; },
    performance: async (pid) => { calls.push(`perf ${pid}`); return { season, matches: perf[pid] ?? [] }; },
    events: async (pid, matchId) => {
      calls.push(`events ${pid} ${matchId}`);
      return [{ type: 4237, points: 5 }, { type: 4231, points: 5 }, { type: 4231, points: 5 }, { type: -8, points: 0 }, { type: 4240, points: -1 }];
    },
  };
  return { api, calls };
}
const empty = (): KbHistory => emptyHistory();

describe("gameOf", () => {
  it("sums each event type's points, knows whether he started, and drops Kickbase's bookkeeping events", () => {
    expect(gameOf(match(1, { minutes: 64, points: 13 }), [{ type: 4237, points: 5 }, { type: -8, points: 0 }, { type: 4231, points: 5 }, { type: 4231, points: 4 }, { type: -20, points: 0 }]))
      .toEqual({ day: 1, matchId: "m1", team: "2", minutes: 64, start: true, points: 13, events: { 4237: 5, 4231: 9 } });
  });

  it("is a game without minutes for a player who didn't play", () => {
    expect(gameOf(match(1, { minutes: undefined, points: undefined }), undefined)).toEqual({ day: 1, matchId: "m1", team: "2", minutes: 0, start: false, points: 0 });
  });
});

describe("historyDue", () => {
  it("is due with players queued or the table not checked for 12 hours (else no Kickbase login at all)", () => {
    const h = { ...emptyHistory(), checkedAt: NOW.toISOString() };
    expect(historyDue(h, new Date(NOW.getTime() + 3600_000))).toBe(false);
    expect(historyDue({ ...h, queue: ["10"] }, new Date(NOW.getTime() + 3600_000))).toBe(true);
    expect(historyDue(h, new Date(NOW.getTime() + 12 * 3600_000))).toBe(true);
    expect(historyDue(emptyHistory(), NOW)).toBe(true);
  });
});

describe("loadHistory", () => {
  it("starts afresh from a file older code wrote", () => {
    expect(loadHistory(JSON.stringify({ teams: { 2: { name: "Bayern", played: 8 } }, matches: {}, players: {}, queue: [] }))).toEqual(emptyHistory());
    expect(loadHistory(undefined)).toEqual(emptyHistory());
    const h = { ...emptyHistory(), checkedAt: "2026-11-02T12:00:00.000Z" };
    expect(loadHistory(JSON.stringify(h))).toEqual(h);
  });
});

describe("updateHistory", () => {
  it("backfills every player's finished matches and the matches' results", async () => {
    const { api } = fakeApi({ "10": [match(1), match(2), match(3, { state: 0, homeGoals: undefined, awayGoals: undefined, points: undefined, minutes: undefined })], "20": [match(1), match(2)] });
    const h = empty();
    const r = await updateHistory(h, api, NOW, 100);
    expect(r.changed).toBe(true);
    expect(h.players["10"].games.map((g) => g.day)).toEqual([1, 2]);
    expect(h.players["10"]).toMatchObject({ name: "Kane", team: "2", position: 4 });
    expect(h.matches.m1).toEqual({ day: 1, date: "2026-10-01T13:30:00Z", home: "2", away: "3", homeGoals: 2, awayGoals: 1 });
    expect(h.matches.m3).toBeUndefined();
    expect(h.queue).toEqual([]);
  });

  it("stops at the request budget and goes on where it stopped in the next run", async () => {
    const { api, calls } = fakeApi({ "10": [match(1), match(2)], "20": [match(1), match(2)] });
    const h = empty();
    // table + 2 squads + perf 10 + events 10/1 = 5
    await updateHistory(h, api, NOW, 5);
    expect(h.players["10"].games.map((g) => g.day)).toEqual([1]);
    expect(h.queue).toEqual(["10", "20"]);
    calls.length = 0;
    await updateHistory(h, api, new Date(NOW.getTime() + 5 * 60_000), 100);
    // No new table check within 12 hours; matchday 1 isn't fetched again.
    expect(calls).toEqual(["perf 10", "events 10 m2", "perf 20", "events 20 m1", "events 20 m2"]);
    expect(h.queue).toEqual([]);
  });

  it("checks the table at most every 12 hours and then refreshes only clubs that played since", async () => {
    const { api } = fakeApi({ "10": [match(1)], "20": [match(1)] }, 1);
    const h = empty();
    await updateHistory(h, api, NOW, 100);
    const later = fakeApi({ "10": [match(1), match(2)], "20": [match(1)] }, 1);
    later.api.table = async () => { later.calls.push("table"); return [{ id: "2", name: "Bayern", played: 2 }, { id: "3", name: "BVB", played: 1 }]; };
    await updateHistory(h, later.api, new Date(NOW.getTime() + 11 * 3600_000), 100);
    expect(later.calls).toEqual([]);
    await updateHistory(h, later.api, new Date(NOW.getTime() + 12 * 3600_000), 100);
    expect(later.calls).toEqual(["table", "squad 2", "perf 10", "events 10 m2"]);
    expect(h.players["10"].games.map((g) => g.day)).toEqual([1, 2]);
  });

  it("asks for no events of a substitute who stayed on the bench (Kickbase still sends his minutes as 0)", async () => {
    const { api, calls } = fakeApi({ "10": [match(1, { minutes: 0, points: 0 })], "20": [] });
    const h = empty();
    await updateHistory(h, api, NOW, 100);
    expect(calls.filter((c) => c.startsWith("events"))).toEqual([]);
    expect(h.players["10"].games).toEqual([{ day: 1, matchId: "m1", team: "2", minutes: 0, start: false, points: 0 }]);
  });

  it("keeps a player queued while his match is running, without blocking the others", async () => {
    const { api } = fakeApi({ "10": [match(1), match(2, { state: 1, minutes: 30 })], "20": [match(1)] });
    const h = empty();
    await updateHistory(h, api, NOW, 100);
    expect(h.players["10"].games.map((g) => g.day)).toEqual([1]);
    expect(h.players["20"].games.map((g) => g.day)).toEqual([1]);
    expect(h.queue).toEqual(["10"]);
  });

  it("starts the next season afresh instead of taking its matchdays for the old ones", async () => {
    const { api } = fakeApi({ "10": [match(1)], "20": [match(1)] });
    const h = empty();
    await updateHistory(h, api, NOW, 100);
    const next = fakeApi({ "10": [match(1, { matchId: "n1", date: "2027-08-20T18:30:00Z" })], "20": [] }, 0, "2027/2028");
    await updateHistory(h, next.api, new Date(NOW.getTime() + 13 * 3600_000), 100);
    expect(h.season).toBe("2027/2028");
    expect(h.players["10"].games.map((g) => g.matchId)).toEqual(["n1"]);
    expect(Object.keys(h.matches)).toEqual(["n1"]);
  });

  it("does nothing when nothing is due", async () => {
    const { api } = fakeApi({ "10": [match(1)], "20": [match(1)] });
    const h = empty();
    await updateHistory(h, api, NOW, 100);
    const r = await updateHistory(h, api, new Date(NOW.getTime() + 60_000), 100);
    expect(r).toEqual({ changed: false, requests: 0 });
  });
});
