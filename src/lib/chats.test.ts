import { describe, expect, it } from "vitest";
import { chatAccount, chatLines, chatNews, conversationState, textStart, type ChatState, type ConvComment } from "./chats.ts";

const at = (min: number) => new Date(Date.UTC(2026, 10, 6, 12, min)).toISOString();
const c = (id: number, user: string, min: number, score: number, replies: ConvComment[] = [], extra: Partial<ConvComment> = {}): ConvComment =>
  ({ id, user, date: at(min), text: `Text ${id}`, score, replies, ...extra });
const POLL = { question: "Wer startet im Sturm?", total: 48, options: [{ label: "Guirassy", pct: 64 }, { label: "Beier", pct: 28 }, { label: "Adeyemi", pct: 8 }] };

// Your Umfrage (1); Mats answers (2), you answer Mats (4), Kalle answers last (3).
const mineStarted = c(1, "Toni", 0, 9, [c(2, "Mats_09", 10, 4, [c(4, "Toni", 20, 2)]), c(3, "Kalle", 30, 2, [], { text: "Glaub ich erst, wenn ich die Aufstellung sehe." })], { poll: POLL });
// Jonas' comment with a poll; you answer it (11), Lukas after you (12).
const answered = c(10, "Jonas", 0, 5, [c(11, "Toni", 5, 1), c(12, "Lukas", 8, 0)], { poll: POLL });

const base: ChatState = { score: 9, mine: { 1: 9, 4: 2 }, answers: 3, others: [2, 3], poll: { total: 48, leader: { label: "Guirassy", pct: 64 } } };

describe("conversationState", () => {
  it("collects what you wrote, the others' answers, the newest answer and your Umfrage", () => {
    expect(conversationState(mineStarted, [1, 4], true)).toEqual({
      score: 9,
      mine: { 1: 9, 4: 2 },
      answers: 3,
      others: [2, 3],
      latest: { user: "Kalle", text: "Glaub ich erst, wenn ich die Aufstellung sehe.", date: at(30) },
      poll: { total: 48, leader: { label: "Guirassy", pct: 64 } },
      to: "Mats_09",
    });
  });

  it("an answer in someone else's conversation: their votes and poll aren't yours", () => {
    const s = conversationState(answered, [11], false);
    expect(s.mine).toEqual({ 11: 1 });
    expect(s.score).toBeUndefined();
    expect(s.poll).toBeUndefined();
    expect(s.others).toEqual([12]);
    expect(s.to).toBe("Jonas");
  });

  it("no one to answer when your newest word is the comment itself", () => {
    expect(conversationState(c(5, "Toni", 0, 1), [5], true).to).toBeUndefined();
  });

  it("an Umfrage without votes has no leader", () => {
    const empty = { ...POLL, total: 0, options: POLL.options.map((o) => ({ ...o, pct: 0 })) };
    expect(conversationState(c(6, "Toni", 0, 0, [], { poll: empty }), [6], true).poll).toEqual({ total: 0 });
  });
});

describe("chatNews", () => {
  it("nothing to compare yet, or nothing changed", () => {
    expect(chatNews(base, undefined)).toBeUndefined();
    expect(chatNews(undefined, base)).toBeUndefined();
    expect(chatNews(base, base)).toBeUndefined();
  });

  it("counts new answers from others", () => {
    expect(chatNews({ ...base, others: [2, 3, 7] }, base)).toEqual({ answers: 1, votes: 0, poll: 0 });
  });

  it("counts the change in your votes, but not for a comment of yours that's new since", () => {
    expect(chatNews({ ...base, mine: { 1: 12, 4: 2 } }, base)).toEqual({ answers: 0, votes: 3, poll: 0 });
    expect(chatNews({ ...base, mine: { 1: 9, 4: 1 } }, base)).toEqual({ answers: 0, votes: -1, poll: 0 });
    expect(chatNews({ ...base, mine: { ...base.mine, 8: 5 } }, base)).toBeUndefined();
  });

  it("counts new votes in your Umfrage", () => {
    expect(chatNews({ ...base, poll: { total: 54, leader: { label: "Guirassy", pct: 61 } } }, base)).toEqual({ answers: 0, votes: 0, poll: 6 });
  });

  it("a gone conversation has no news", () => {
    expect(chatNews({ ...base, others: [2, 3, 7], gone: true }, base)).toBeUndefined();
  });
});

describe("chatLines", () => {
  const ok = { started: true, status: "ok" as const };
  it("says what you wrote", () => {
    expect(chatLines({ ...ok, kind: "poll", text: "Wer startet im Sturm?" }).mine).toBe("Umfrage: Wer startet im Sturm?");
    expect(chatLines({ ...ok, kind: "answer", text: "Nie im Leben", state: { ...base, to: "Kalle" } }).mine).toBe("Du antwortest Kalle: Nie im Leben");
    expect(chatLines({ ...ok, kind: "answer", text: "Nie im Leben" }).mine).toBe("Du: Nie im Leben");
    expect(chatLines({ ...ok, kind: "comment", text: "Endlich, Kapitän rein!" }).mine).toBe("Du: Endlich, Kapitän rein!");
  });

  it("sums up where it stands", () => {
    const comment = { ...ok, kind: "comment" as const, text: "x" };
    expect(chatLines({ ...comment, state: { score: 14, mine: { 1: 14 }, answers: 3, others: [2, 3, 4] } }).status).toBe("▲ 14 · 3 Antworten");
    expect(chatLines({ ...comment, state: { score: 2, mine: { 1: 2 }, answers: 0, others: [] } }).status).toBe("▲ 2 · keine Antworten");
    expect(chatLines({ ...comment, state: { score: 2, mine: { 1: 2 }, answers: 1, others: [2] } }).status).toBe("▲ 2 · 1 Antwort");
    expect(chatLines({ ...ok, kind: "poll", text: "x", state: { ...base, answers: 2 } }).status).toBe("48 Stimmen · Guirassy 64 % · 2 Antworten");
    expect(chatLines({ ...comment, started: false, kind: "answer", state: { mine: { 11: 1 }, answers: 2, others: [12] } }).status).toBe("2 Antworten");
    expect(chatLines(comment).status).toBe("");
  });

  it("says what's new", () => {
    const poll = { ...ok, kind: "poll" as const, text: "x" };
    const latest = { user: "Kalle", text: "Glaub ich erst, wenn ich die Aufstellung sehe.", date: at(30) };
    expect(chatLines({ ...poll, state: { ...base, latest }, news: { answers: 1, votes: 0, poll: 0 } }).status).toBe("Kalle: „Glaub ich erst, wenn ich die…“");
    expect(chatLines({ ...poll, state: { ...base, latest }, news: { answers: 2, votes: 3, poll: 0 } }).status).toBe("2 neue Antworten · ▲ +3");
    expect(chatLines({ ...poll, state: base, news: { answers: 0, votes: -1, poll: 0 } }).status).toBe("▲ −1");
    expect(chatLines({ ...poll, state: base, news: { answers: 0, votes: 0, poll: 6 } }).status).toBe("+6 Stimmen · Guirassy 64 %");
    expect(chatLines({ ...poll, state: base, news: { answers: 0, votes: 0, poll: 1 } }).status).toBe("+1 Stimme · Guirassy 64 %");
  });

  it("gone and finished conversations", () => {
    expect(chatLines({ ...ok, kind: "comment", text: "x", status: "gone", state: base }).status).toBe("nicht mehr verfügbar");
    expect(chatLines({ ...ok, kind: "comment", text: "x", status: "over", state: { score: 3, mine: { 1: 3 }, answers: 1, others: [2] } }).status).toBe("Spiel vorbei · ▲ 3 · 1 Antwort");
  });
});

describe("textStart", () => {
  it("one line, cut at a word with …", () => {
    expect(textStart("Glaub ich erst, wenn ich die Aufstellung sehe.", 40)).toBe("Glaub ich erst, wenn ich die…");
    expect(textStart("  a\n\nb  ")).toBe("a b");
    expect(textStart("kurz", 40)).toBe("kurz");
  });
});

describe("chatAccount", () => {
  it("the same account however the name is typed, another key gives another id", async () => {
    const a = await chatAccount("Toni ", "key-1");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await chatAccount("toni", "key-1")).toBe(a);
    expect(await chatAccount("toni", "key-2")).not.toBe(a);
    expect(await chatAccount("anna", "key-1")).not.toBe(a);
  });
});
