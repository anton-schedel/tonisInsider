import { describe, expect, it } from "vitest";
import { badgeCount, CHECK_EVERY_MS, dueCheck } from "./chatsClient.ts";
import { jumpTarget } from "./commentUi.ts";
import type { ChatView } from "./chatsApi.ts";

const view = (over: Partial<ChatView>): ChatView => ({
  id: 1, place: { title: "x", href: "/artikel/1/" }, link: "/artikel/1/#c1", started: true, kind: "comment",
  activityAt: "2026-11-06T12:00:00.000Z", status: "ok", lines: { mine: "Du: x", status: "" }, checked: true, ...over,
});
const news = { answers: 1, votes: 0, poll: 0 };

describe("badgeCount", () => {
  it("counts each chat with news once, only while it can be opened", () => {
    expect(badgeCount([view({ news }), view({ news: { answers: 3, votes: 5, poll: 2 } }), view({}), view({ news, status: "over" }), view({ news, status: "gone" })])).toBe(2);
    expect(badgeCount([])).toBe(0);
  });
});

describe("dueCheck", () => {
  it("at most every 3 minutes", () => {
    expect(CHECK_EVERY_MS).toBe(180_000);
    expect(dueCheck(undefined, 1_000_000)).toBe(true);
    expect(dueCheck(1_000_000 - 179_000, 1_000_000)).toBe(false);
    expect(dueCheck(1_000_000 - 180_000, 1_000_000)).toBe(true);
  });
});

describe("jumpTarget", () => {
  it("the comment a link points at (#c<id>)", () => {
    expect(jumpTarget("#c123")).toBe(123);
    expect(jumpTarget("#x")).toBeUndefined();
    expect(jumpTarget("")).toBeUndefined();
    expect(jumpTarget("#c")).toBeUndefined();
  });
});

describe("refreshChat", () => {
  it("follows the thread's batches, telling the site which batch it asks for, up to 12", async () => {
    const { refreshChat } = await import("./chatsClient.ts");
    const asked: string[] = [];
    const next = { offset: 10, goffset: 0, moffset: 0, cursor: 5 };
    const fetchStub = async (url: string) => {
      asked.push(url);
      return new Response(JSON.stringify(asked.length < 3 ? { next: { ...next, cursor: asked.length } } : { chat: view({ id: 7 }) }));
    };
    const original = globalThis.fetch;
    globalThis.fetch = fetchStub as unknown as typeof fetch;
    try {
      expect((await refreshChat(7))?.id).toBe(7);
      expect(asked[0]).toBe("/api/chats/7/");
      expect(asked[1]).toContain("cursor=1");
      expect(asked[1]).toContain("n=1");
      expect(asked[2]).toContain("n=2");
      asked.length = 0;
      globalThis.fetch = (async (url: string) => { asked.push(url); return new Response(JSON.stringify({ next })); }) as unknown as typeof fetch;
      expect(await refreshChat(7)).toBeUndefined();
      expect(asked).toHaveLength(12);
    } finally {
      globalThis.fetch = original;
    }
  });
});
