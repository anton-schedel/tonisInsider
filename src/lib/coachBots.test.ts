import { describe, expect, it } from "vitest";
import { askModel, batchPlan, botNames, botRows, dropSimilar, parseBots, type BotComment } from "./coachBots.ts";
import type { CoachPost } from "./coachPosts.ts";

const lineup: CoachPost = {
  id: 900_001_000, type: "lineup", publishedAt: "2026-10-28T18:00:00.000Z", updatedAt: "2026-10-28T12:00:00.000Z",
  data: {
    headline: "Aufstellung des TuS Schnöselmob",
    lineup: { lines: [["Coach"], ["Gerl", "Dallwig", "Chatfield"], ["Torres", "Ellenberger"], ["Loibl"]], bench: ["Enciu", "Schedel"] },
    bots: { on: true, context: "Nguyen ist wieder dabei." },
  },
};

describe("parseBots", () => {
  const list = [{ text: "Endlich wieder Loibl vorne!", minute: 2 }, { text: "Genau", minute: 4, replyTo: 0 }];
  const named = list.map((c) => ({ name: "", ...c }));
  it("reads a clean JSON list, also inside code fences or prose", () => {
    expect(parseBots(JSON.stringify(list))).toEqual(named);
    expect(parseBots("Hier sind die Kommentare:\n```json\n" + JSON.stringify(list) + "\n```\nViel Spaß!")).toEqual(named);
    expect(parseBots("Tut mir leid, das kann ich nicht.")).toEqual([]);
    expect(parseBots("[{oops")).toEqual([]);
  });
  it("drops what it can't use and clamps the minute", () => {
    const out = parseBots(JSON.stringify([
      { text: "  ", minute: 1 },
      { text: "x".repeat(400), minute: 1 },
      { text: "nach dem Spiel", minute: 95 },
      { text: "vorher", minute: -3, replyTo: 7 },
    ]));
    expect(out).toEqual([{ name: "", text: "nach dem Spiel", minute: 18 }, { name: "", text: "vorher", minute: 0 }]);
  });
  it("keeps the good comments when one item breaks the JSON (seen from Grok)", () => {
    const answer = '```json\n[\n {"text": "a", "minute": 1},\n {"text": "poll": {"question": "Wer?", "options": ["A", "B"]}},\n {"text": "c {mit} \\"Klammern\\"", "minute": 2, "replyTo": 0}\n]\n```';
    expect(parseBots(answer)).toEqual([{ name: "", text: "a", minute: 1 }, { name: "", text: 'c {mit} "Klammern"', minute: 2, replyTo: 0 }]);
  });
  it("keeps replies only to earlier comments, one level deep", () => {
    const out = parseBots(JSON.stringify([{ text: "a", minute: 1, replyTo: 1 }, { text: "b", minute: 2, replyTo: 0 }, { text: "c", minute: 3, replyTo: 1 }]));
    expect(out.map((c) => c.replyTo)).toEqual([undefined, 0, 0]);
  });
});

describe("botRows", () => {
  it("dates them after the post and replies after their parent", () => {
    const bots: BotComment[] = [{ name: "A", text: "a", minute: 5 }, { name: "B", text: "b", minute: 1, replyTo: 0 }, { name: "C", text: "c", minute: 0 }];
    const rows = botRows("2026-10-28T18:00:00.000Z", bots);
    const at = (n: string) => Date.parse(rows.find((r) => r.name === n)!.createdAt);
    const start = Date.parse("2026-10-28T18:00:00.000Z");
    expect(at("C")).toBeGreaterThanOrEqual(start);
    expect(at("A")).toBeGreaterThanOrEqual(start + 5 * 60_000);
    expect(at("B")).toBeGreaterThan(at("A"));
    expect(rows.find((r) => r.name === "B")!.replyTo).toBe(0);
    expect(rows.every((r) => Date.parse(r.createdAt) < start + 20 * 60_000)).toBe(true);
  });
});

describe("askModel", () => {
  it("sends an OpenAI-style chat request and returns the answer", async () => {
    let sent: { url: string; body: { model: string; messages: { role: string }[] }; auth: string | null } | undefined;
    const fetcher = (async (url: string, init: RequestInit) => {
      sent = { url, body: JSON.parse(String(init.body)), auth: new Headers(init.headers).get("authorization") };
      return Response.json({ choices: [{ message: { content: "[]" } }] });
    }) as typeof fetch;
    const answer = await askModel({ url: "https://llm.example/api", key: "k", model: "m", batch: 10 }, { system: "s", user: "u" }, fetcher);
    expect(answer).toBe("[]");
    expect(sent?.url).toBe("https://llm.example/api/chat/completions");
    expect(sent?.auth).toBe("Bearer k");
    expect(sent?.body.model).toBe("m");
    expect(sent?.body.messages.map((m) => m.role)).toEqual(["system", "user"]);
  });
  it("fails on an error status", async () => {
    const fetcher = (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
    await expect(askModel({ url: "https://x", key: "k", model: "m", batch: 10 }, { system: "s", user: "u" }, fetcher)).rejects.toThrow();
  });
  it("reads the answer as it streams in (so the connection never sits idle)", async () => {
    let body: { stream?: boolean } = {};
    const sse = ['data: {"choices":[{"delta":{"role":"assistant"}}]}', 'data: {"choices":[{"delta":{"content":"[{\\"a\\""}}]}', 'data: {"choices":[{"delta":{"content":":1}]"}}]}', "data: [DONE]", ""].join("\n\n");
    const fetcher = (async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return new Response(sse, { headers: { "content-type": "text/event-stream" } });
    }) as typeof fetch;
    expect(await askModel({ url: "https://x/api", key: "k", model: "m", batch: 10 }, { system: "s", user: "u" }, fetcher)).toBe('[{"a":1}]');
    expect(body.stream).toBe(true);
  });
});

describe("shouldWriteBots", () => {
  it("writes them for a post that isn't out yet, never adds more to one that is", async () => {
    const { shouldWriteBots } = await import("./coachBots.ts");
    const now = new Date("2026-10-28T17:00:00.000Z");
    expect(shouldWriteBots(lineup, now, 0)).toBe("write");
    expect(shouldWriteBots(lineup, now, 30)).toBe("write");
    const out = { ...lineup, publishedAt: "2026-10-28T16:00:00.000Z" };
    expect(shouldWriteBots(out, now, 30)).toBe("keep");
    expect(shouldWriteBots(out, now, 0)).toBe("write");
    expect(shouldWriteBots({ ...lineup, data: { ...lineup.data, bots: { on: false } } }, now, 30)).toBe("clear");
  });
});

describe("batchPlan", () => {
  it("splits the comments into batches of up to 10 and deals the topics out", () => {
    expect(batchPlan(30, ["a", "b", "c", "d"])).toEqual([
      { count: 10, topics: ["a", "d"] }, { count: 10, topics: ["b"] }, { count: 10, topics: ["c"] },
    ]);
    expect(batchPlan(25, [])).toEqual([{ count: 9, topics: [] }, { count: 8, topics: [] }, { count: 8, topics: [] }]);
    expect(batchPlan(42, ["a", "b"], 50)).toEqual([{ count: 42, topics: ["a", "b"] }]);
  });
});

describe("commentPlan", () => {
  it("gives each comment its own job: topics 2–3 times, callbacks, replies to earlier ones (max 3 each), comparisons and polls as asked", async () => {
    const { commentPlan, applyPlan } = await import("./coachBots.ts");
    for (let k = 0; k < 20; k++) {
      const plan = commentPlan(32, { topics: ["Pizza im Cadu"], stories: ["Kowol auf Toilette", "Loibl nach 2 Uhr", "Torres feiert"], compare: 1, forms: ["als Spitzname"], polls: 1 });
      expect(plan).toHaveLength(32);
      const pizza = plan.filter((s) => s.about === "Thema: Pizza im Cadu").length;
      expect(pizza).toBeGreaterThanOrEqual(2);
      expect(pizza).toBeLessThanOrEqual(3);
      expect(plan.some((s) => s.about.startsWith("Anspielung"))).toBe(true);
      expect(plan.filter((s) => s.compare)).toHaveLength(1);
      expect(plan.filter((s) => s.poll)).toHaveLength(1);
      const replies = plan.flatMap((s, i) => (s.replyTo !== undefined ? [[i, s.replyTo] as const] : []));
      expect(replies.length).toBeGreaterThan(3);
      for (const [i, t] of replies) {
        expect(t).toBeLessThan(i);
        expect(plan[t].replyTo).toBeUndefined();
      }
      expect(Math.max(...Object.values(Object.groupBy(replies, ([, t]) => t)).map((r) => r!.length))).toBeLessThanOrEqual(3);
      expect(plan.map((s) => s.minute)).toEqual([...plan.map((s) => s.minute)].sort((a, b) => a - b));
    }
    // The model's answer goes into the slots by "nr": a missing one doesn't shift the threads; a poll only where planned.
    const plan = [
      { voice: "a", length: "x", about: "den Beitrag", minute: 0 },
      { voice: "b", length: "x", about: "den Beitrag", minute: 2 },
      { voice: "c", length: "x", about: "antwortet", minute: 5, replyTo: 1 },
    ];
    const out = applyPlan(parseBots(JSON.stringify([
      { nr: 0, text: "eins", poll: { question: "Wer?", options: ["A", "B"], votes: [1, 2] } },
      { nr: 2, text: "drei" },
    ])), plan);
    expect(out).toEqual([{ name: "", text: "eins", minute: 0 }, { name: "", text: "drei", minute: 5 }]);
  });
});

describe("seasonBefore", () => {
  it("leaves out a hand-written result the coach posted too (else the bots count two 0:2)", async () => {
    const { seasonBefore, SEASON } = await import("./coachBots.ts");
    expect(seasonBefore(["22.10.: 0:2 gegen FC Förderbedarf"])).toEqual(SEASON.filter((l) => !l.includes("Förderbedarf")));
    expect(seasonBefore([])).toEqual(SEASON);
  });
});

describe("body insult filter", () => {
  it("drops comments that insult someone's body anyway", () => {
    const out = parseBots(JSON.stringify([
      { name: "A", text: "Fette sau Daniel, wir brauchen dich", minute: 1 },
      { name: "B", text: "Der ist doch viel zu dick zum Laufen", minute: 2 },
      { name: "C", text: "Torres muss mehr laufen", minute: 3 },
      { name: "D", text: "Fett gespielt heute!", minute: 4 },
      { name: "E", text: "Wie Neuer, nur mit mehr Bierbauch 😂", minute: 5 },
      { name: "F", text: "Unser Moppel im Tor hält wieder nix", minute: 6 },
      { name: "G", text: "Bauchgefühl sagt: wir gewinnen", minute: 7 },
    ]));
    expect(out.map((c) => c.text[0])).toEqual(["T", "F", "B"]);
  });
});

describe("startNow", () => {
  it("moves planned comments so the first comes now, keeping the gaps", async () => {
    const { startNow } = await import("./coachBots.ts");
    const now = new Date("2026-10-24T07:30:00.000Z");
    const rows = [
      { id: 2, created_at: "2026-10-24T09:05:00.000Z" },
      { id: 1, created_at: "2026-10-24T09:00:00.000Z" },
      { id: 3, created_at: "2026-10-24T07:00:00.000Z" }, // already out: stays
    ];
    expect(startNow(rows, now)).toEqual([
      { id: 1, created_at: "2026-10-24T07:30:05.000Z" },
      { id: 2, created_at: "2026-10-24T07:35:05.000Z" },
    ]);
  });
});

describe("botNames", () => {
  it("mixes forum names, never with a player's name in them", async () => {
    const { playerNames } = await import("./coachBots.ts");
    const words = playerNames(lineup);
    expect(words).toEqual(expect.arrayContaining(["gerl", "loibl", "nguyen", "kowol"]));
    // Seeded, so the test doesn't fail now and then.
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    const names = botNames(200, [...words, "max"], rnd);
    expect(names).toHaveLength(200);
    expect(names.filter((n) => words.some((w) => n.toLowerCase().includes(w)) || n.toLowerCase().includes("max"))).toEqual([]);
    expect(new Set(names).size).toBeGreaterThan(150);
    const few = botNames(30, [], rnd).map((n) => n.replace(/[\d_. ].*$/, "").toLowerCase());
    expect(new Set(few).size).toBeGreaterThan(25);
  });
});

describe("bot polls and upvotes", () => {
  it("reads a poll and upvotes from the model's answer, cleaned", () => {
    const out = parseBots(JSON.stringify([
      { name: "Flo12", text: "Abstimmung!", minute: 3, upvotes: 99, poll: { question: " Loibl raus??? ", options: ["Ja", " Nein ", "", "Halbzeit", "x", "y"], votes: [12, 7, 3, 1] } },
      { name: "basti91", text: "Hä", minute: 4, upvotes: -2 },
    ]));
    expect(out[0].upvotes).toBe(40);
    expect(out[0].poll).toEqual({ question: "Loibl raus???", options: ["Ja", "Nein", "Halbzeit", "x"], votes: [12, 7, 3, 1] });
    expect(out[1].upvotes).toBe(0);
  });
  it("drops a poll that breaks the rules, keeps the comment", () => {
    const out = parseBots(JSON.stringify([
      { name: "A", text: "Frage", minute: 1, poll: { question: "Wer ist die fette Sau?", options: ["Torres", "Loibl"], votes: [1, 1] } },
      { name: "B", text: "Frage", minute: 1, poll: { question: "Wer spielt?", options: ["Nur eine"], votes: [3] } },
    ]));
    expect(out.map((c) => c.poll)).toEqual([undefined, undefined]);
    expect(out).toHaveLength(2);
  });
  it("lets one or two batches of a post write a poll, none once it has two", async () => {
    const { pollAllowance } = await import("./coachBots.ts");
    for (const r of [0, 0.5, 0.99]) {
      const a = pollAllowance(3, 0, () => r);
      expect(a).toHaveLength(3);
      const sum = a.reduce((x, y) => x + y, 0);
      expect(sum).toBeGreaterThanOrEqual(1);
      expect(sum).toBeLessThanOrEqual(2);
    }
    expect(pollAllowance(2, 2)).toEqual([0, 0]);
    expect(pollAllowance(2, 1, () => 0.99).reduce((x, y) => x + y, 0)).toBe(1);
  });
});

describe("worn comparisons", () => {
  it("drops Kahn/Starke comparisons, keeps 'ein neuer Spieler'", () => {
    const out = parseBots(JSON.stringify([
      { text: "Waldeck mit einer Hand wie Oliver Kahn", minute: 1 },
      { text: "Unser Coach, die Krake 🐙", minute: 1 },
      { text: "Ein neuer Spieler im Tor, spannend", minute: 1 },
    ]));
    expect(out.map((o) => o.text)).toEqual(["Ein neuer Spieler im Tor, spannend"]);
  });
});

describe("dropSimilar", () => {
  const c = (text: string, replyTo?: number, poll = false): BotComment => ({ name: "x", text, minute: 0, ...(replyTo !== undefined ? { replyTo } : {}), ...(poll ? { poll: { question: text, options: ["Ja", "Nein"], votes: [1, 1] } } : {}) });
  it("drops near-repeats (seen on real posts), keeps different takes and polls, re-points replies", () => {
    const out = dropSimilar([
      c("ach manno, ohne ellenberger wird das richtig schwer... hoffentlich finden die nen plan"),
      c("Der hat doch erst letzte Woche den Ehrentreffer gemacht."),
      c("Ach nein, nicht schon wieder... ohne Ellenberger wird's richtig schwer gegen die."),
      c("Kopf hoch, das wird schon", 2),
      c("Wer soll Ellenberger ersetzen?", undefined, true),
      c("Waldeck erinnert mich an den jungen Harry Kane, hat diesen Torriecher"),
    ]);
    expect(out.map((o) => o.text.slice(0, 12))).toEqual(["ach manno, o", "Der hat doch", "Kopf hoch, d", "Wer soll Ell", "Waldeck erin"]);
    expect(out[2].replyTo).toBe(0);
  });
});
