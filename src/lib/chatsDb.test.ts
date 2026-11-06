import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { D1 } from "cloudflare:workers";
import { getChat, KEEP, listChats, markSeen, recordWrite, saveState, SHOWN, type ChatWrite } from "./chatsDb.ts";
import type { ChatState } from "./chats.ts";

/** The real migration in an in-memory SQLite, behind the bit of D1 chatsDb uses. */
function db(): D1 {
  const sql = new DatabaseSync(":memory:");
  sql.exec(readFileSync(join(process.cwd(), "migrations", "0008_chats.sql"), "utf8"));
  const statement = (q: string, v: SQLInputValue[]) => ({
    first: async () => { const r = sql.prepare(q).get(...v); return r ? { ...r } : null; },
    all: async () => ({ results: sql.prepare(q).all(...v).map((r) => ({ ...r })) }),
    run: async () => { const r = sql.prepare(q).run(...v); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
  });
  return {
    prepare: (q: string) => ({ bind: (...v: SQLInputValue[]) => statement(q, v) }),
    batch: async (list: { run(): Promise<unknown> }[]) => { for (const s of list) await s.run(); return []; },
  } as unknown as D1;
}

const ME = "a".repeat(64);
const OTHER = "b".repeat(64);
const place = { title: "Wirtz zurück im Training", href: "/artikel/420300/", club: { name: "Leverkusen", slug: "bayer-leverkusen" } };
const t = (min: number) => new Date(Date.UTC(2026, 10, 6, 12, min));
const write = (over: Partial<ChatWrite> = {}): ChatWrite => ({ thread: "420300", root: 1, id: 1, kind: "comment", text: "Der startet sicher", place, ...over });
const state = (over: Partial<ChatState> = {}): ChatState => ({ score: 3, mine: { 1: 3 }, answers: 0, others: [], ...over });

describe("chats storage", () => {
  it("remembers a new conversation you started", async () => {
    const d = db();
    await recordWrite(d, ME, write(), t(0));
    const [row] = await listChats(d, ME);
    expect(row).toMatchObject({ thread: "420300", root: 1, mine: [1], started: true, kind: "comment", text: "Der startet sicher", place, wroteAt: t(0).toISOString(), activityAt: t(0).toISOString() });
    expect(row!.state).toBeUndefined();
    expect(row!.seen).toBeUndefined();
  });

  it("an answer in someone else's conversation isn't one you started", async () => {
    const d = db();
    await recordWrite(d, ME, write({ root: 7, id: 9, kind: "answer" }), t(0));
    expect((await listChats(d, ME))[0]).toMatchObject({ root: 7, mine: [9], started: false });
  });

  it("writing again in a conversation keeps one row, adds the comment once and counts as looked at", async () => {
    const d = db();
    await recordWrite(d, ME, write(), t(0));
    const [first] = await listChats(d, ME);
    await saveState(d, ME, first!.id, state(), t(1));
    await recordWrite(d, ME, write({ id: 4, kind: "answer", text: "Nie im Leben" }), t(5));
    await recordWrite(d, ME, write({ id: 4, kind: "answer", text: "Nie im Leben" }), t(6));
    const rows = await listChats(d, ME);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ mine: [1, 4], started: true, kind: "answer", text: "Nie im Leben", wroteAt: t(6).toISOString(), activityAt: t(6).toISOString() });
    expect(rows[0]!.seen).toBeUndefined();
    expect(rows[0]!.state).toEqual(state());
  });

  it(`keeps ${KEEP} conversations per account and lists the ${SHOWN} you wrote in last, newest activity first`, async () => {
    const d = db();
    for (let i = 1; i <= KEEP + 1; i++) await recordWrite(d, ME, write({ root: i, id: i }), t(i));
    // The oldest of the shown ones got an answer after everything else.
    const shown = await listChats(d, ME);
    const oldestShown = shown.find((r) => r.root === KEEP + 1 - SHOWN + 1)!;
    await saveState(d, ME, oldestShown.id, state({ latest: { user: "Kalle", text: "Ja", date: t(90).toISOString() } }), t(91));
    const rows = await listChats(d, ME);
    expect(rows).toHaveLength(SHOWN);
    expect(rows[0]!.root).toBe(KEEP + 1 - SHOWN + 1);
    expect(rows.slice(1).map((r) => r.root)).toEqual([21, 20, 19, 18, 17, 16, 15, 14, 13]);
    const all = await d.prepare("SELECT root FROM chats WHERE account = ? ORDER BY root").bind(ME).all<{ root: number }>();
    expect(all.results.map((r) => r.root)).toEqual(Array.from({ length: KEEP }, (_, i) => i + 2));
  });

  it("another account sees nothing and can't read or mark your chat", async () => {
    const d = db();
    await recordWrite(d, ME, write(), t(0));
    const [row] = await listChats(d, ME);
    expect(await listChats(d, OTHER)).toEqual([]);
    expect(await getChat(d, OTHER, row!.id)).toBeUndefined();
    await saveState(d, OTHER, row!.id, state(), t(1));
    expect((await getChat(d, ME, row!.id))!.state).toBeUndefined();
  });

  it("the first state read is the baseline; later reads leave what you saw alone until you look", async () => {
    const d = db();
    await recordWrite(d, ME, write(), t(0));
    const id = (await listChats(d, ME))[0]!.id;
    await saveState(d, ME, id, state(), t(1));
    let row = (await getChat(d, ME, id))!;
    expect(row.seen).toEqual(state());
    expect(row.checkedAt).toBe(t(1).toISOString());
    expect(row.activityAt).toBe(t(0).toISOString());

    const later = state({ score: 5, mine: { 1: 5 }, answers: 1, others: [2], latest: { user: "Kalle", text: "Ja", date: t(3).toISOString() } });
    await saveState(d, ME, id, later, t(4));
    row = (await getChat(d, ME, id))!;
    expect(row.state).toEqual(later);
    expect(row.seen).toEqual(state());
    expect(row.activityAt).toBe(t(3).toISOString());

    await markSeen(d, ME, id);
    expect((await getChat(d, ME, id))!.seen).toEqual(later);
  });
});
