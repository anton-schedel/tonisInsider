import { describe, expect, it } from "vitest";
import { chatView, fresh, MAX_BATCHES, refreshState } from "./chatsApi.ts";
import type { ChatRow } from "./chatsDb.ts";
import type { AppFeed } from "./appFeed.ts";
import type { ChatState, ConvComment } from "./chats.ts";
import type { Comments, MoreCursor } from "./comments.ts";

const club = { id: 1, slug: "bayer-leverkusen", name: "Leverkusen" };
const LINEUP = "t185708-5ju4n8wsoc85fnut62uav3i8k-14";
const feed = {
  articles: [{ id: 420300, headline: "Wirtz zurück im Training", club }],
  lineups: [{ club, comments: { tmid: 185708, optauuid: "5ju4n8wsoc85fnut62uav3i8k", teamid: 14 } }],
} as unknown as AppFeed;
const at = (min: number) => new Date(Date.UTC(2026, 10, 6, 12, min)).toISOString();
const seen: ChatState = { score: 3, mine: { 1: 3 }, answers: 0, others: [] };
const row = (over: Partial<ChatRow> = {}): ChatRow => ({
  id: 5, thread: "420300", root: 1, mine: [1], started: true, kind: "comment", text: "Der startet sicher",
  place: { title: "Wirtz zurück im Training", href: "/artikel/420300/" }, wroteAt: at(0), activityAt: at(0), ...over,
});
const c = (id: number, user: string, score: number, replies: ConvComment[] = []) =>
  ({ id, user, date: at(id), text: `Text ${id}`, score, vote: 0, replies });

const page = (comments: ConvComment[], next?: MoreCursor): Comments => ({ total: 9, comments: comments as Comments["comments"], ...(next ? { more: next } : {}) });

describe("chatView", () => {
  it("a row with news: the link into the article, what's new", () => {
    const v = chatView(row({ state: { ...seen, others: [2], answers: 1, latest: { user: "Kalle", text: "Ja", date: at(4) } }, seen }), feed);
    expect(v).toMatchObject({ id: 5, link: "/artikel/420300/#c1", status: "ok", news: { answers: 1, votes: 0, poll: 0 }, checked: true });
    expect(v.lines).toEqual({ mine: "Du: Der startet sicher", status: "Kalle: „Ja“" });
  });

  it("not read yet: no news, no status line", () => {
    const v = chatView(row(), feed);
    expect(v).toMatchObject({ status: "ok", checked: false, lines: { status: "" } });
    expect(v.news).toBeUndefined();
  });

  it("gone when the comment or the article is gone; over when the lineup page moved on — no news either way", () => {
    const changed = { state: { ...seen, others: [2], answers: 1 }, seen };
    expect(chatView(row({ ...changed, state: { ...changed.state, gone: true } }), feed)).toMatchObject({ status: "gone", lines: { status: "nicht mehr verfügbar" } });
    expect(chatView(row({ ...changed, thread: "419000" }), feed).status).toBe("gone");
    const lineup = chatView(row({ ...changed, thread: LINEUP }), feed);
    expect(lineup).toMatchObject({ status: "ok" });
    const over = chatView(row({ ...changed, thread: "t1-abcdefgh12-3" }), feed);
    expect(over.status).toBe("over");
    expect(over.news).toBeUndefined();
    // Without the feed nothing is called gone.
    expect(chatView(row({ thread: "419000" }), undefined).status).toBe("ok");
  });
});

describe("refreshState", () => {
  const more: MoreCursor = { offset: 20, goffset: 0, moffset: 0, cursor: 99 };
  const own = async () => ({ comments: [] });

  it("finds the conversation in the first batch", async () => {
    const r = await refreshState(row(), { liga: async () => page([c(9, "X", 0), c(1, "Toni", 4, [c(2, "Kalle", 1)])], more), own });
    expect(r).toMatchObject({ state: { score: 4, mine: { 1: 4 }, answers: 1, others: [2], latest: { user: "Kalle", text: "Text 2", date: at(2) } } });
  });

  it("asks for the next batch while it isn't there, with the cursor it was given", async () => {
    let asked: MoreCursor | undefined;
    const liga = async (_: string, cursor?: MoreCursor) => { asked = cursor; return cursor ? page([c(1, "Toni", 4)]) : page([c(9, "X", 0)], more); };
    expect(await refreshState(row(), { liga, own })).toEqual({ next: more });
    expect(await refreshState(row(), { liga, own }, more)).toMatchObject({ state: { score: 4 } });
    expect(asked).toEqual(more);
  });

  it("gone only once the whole thread was read without it, keeping the last known state", async () => {
    const liga = async () => page([c(9, "X", 0)]);
    const gone = { ...seen, gone: true };
    expect(await refreshState(row({ state: seen }), { liga, own })).toEqual({ state: gone, baseline: gone });
    const never = { mine: {}, answers: 0, others: [], gone: true };
    expect(await refreshState(row(), { liga, own })).toEqual({ state: never, baseline: never });
  });

  it("our own posts are read from the database", async () => {
    let post = 0;
    const ownPost = async (id: number) => { post = id; return { comments: [c(1, "Toni", 2, [c(3, "Jonas", 0)])] as ConvComment[] }; };
    const r = await refreshState(row({ thread: "900001001" }), { liga: async () => { throw new Error("not LigaInsider"); }, own: ownPost });
    expect(post).toBe(900001001);
    expect(r).toMatchObject({ state: { score: 2, others: [3] } });
  });
});

describe("fresh", () => {
  const now = new Date(Date.UTC(2026, 10, 6, 12, 10));
  it("a read under a minute ago is fresh enough", () => {
    expect(fresh(new Date(now.getTime() - 59_000).toISOString(), now)).toBe(true);
    expect(fresh(new Date(now.getTime() - 61_000).toISOString(), now)).toBe(false);
    expect(fresh(undefined, now)).toBe(false);
  });

  it("a conversation too deep in its thread is looked for again only after 15 minutes", () => {
    expect(fresh(new Date(now.getTime() - 14 * 60_000).toISOString(), now, true)).toBe(true);
    expect(fresh(new Date(now.getTime() - 16 * 60_000).toISOString(), now, true)).toBe(false);
  });
});

describe("what you had seen when you wrote", () => {
  const own = async () => ({ comments: [] });
  it("answers before your write and your new comment's votes count as seen; what came after is news", async () => {
    // Jonas' comment; Kalle answered before you, you answered at 5, Lukas after you; your answer has a vote by now.
    const tree = c(10, "Jonas", 7, [{ ...c(3, "Kalle", 0), date: at(3) }, { ...c(11, "Toni", 1), date: at(5) }, { ...c(12, "Lukas", 0), date: at(8) }]);
    const r = await refreshState(row({ root: 10, mine: [11], started: false, kind: "answer", wroteAt: at(5) }), { liga: async () => page([tree]), own });
    if (!("state" in r)) throw new Error("expected a state");
    expect(r.baseline.others).toEqual([3]);
    expect(r.baseline.mine).toEqual({ 11: 0 });
    expect(r.state.others).toEqual([3, 12]);
  });

  it("your own Umfrage starts from nothing: every vote is news", async () => {
    const poll = { question: "Wer?", total: 6, options: [{ label: "A", pct: 50 }, { label: "B", pct: 50 }] };
    const r = await refreshState(row({ wroteAt: at(1), kind: "poll" }), { liga: async () => page([{ ...c(1, "Toni", 2), poll }]), own });
    if (!("state" in r)) throw new Error("expected a state");
    expect(r.baseline).toMatchObject({ score: 0, mine: { 1: 0 }, poll: { total: 0 } });
  });
});

describe("a conversation deeper than the batches looked through", () => {
  const own = async () => ({ comments: [] });
  const more: MoreCursor = { offset: 120, goffset: 0, moffset: 0, cursor: 7 };
  it(`on the last of ${MAX_BATCHES} batches: the last known state, marked deep, instead of another cursor`, async () => {
    const before: MoreCursor = { ...more, offset: 110, cursor: 6 };
    const liga = async () => page([c(9, "X", 0)], more);
    expect(await refreshState(row({ state: seen }), { liga, own }, before, false)).toEqual({ next: more });
    const r = await refreshState(row({ state: seen }), { liga, own }, before, true);
    expect(r).toMatchObject({ state: { ...seen, deep: true } });
  });

  it("never found: says so instead of an empty line", () => {
    const v = chatView(row({ state: { mine: {}, answers: 0, others: [], deep: true } }), feed);
    expect(v.lines.status).toBe("Weit unten im Thread");
    expect(v.news).toBeUndefined();
  });
});
