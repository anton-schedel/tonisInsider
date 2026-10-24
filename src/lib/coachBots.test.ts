import { describe, expect, it } from "vitest";
import { askModel, batchPlan, botPrompt, botRows, parseBots, type BotComment } from "./coachBots.ts";
import type { CoachPost } from "./coachPosts.ts";

const lineup: CoachPost = {
  id: 900_001_000, type: "lineup", publishedAt: "2026-10-28T18:00:00.000Z", updatedAt: "2026-10-28T12:00:00.000Z",
  data: {
    headline: "Aufstellung des TuS Schnöselmob",
    lineup: { lines: [["Coach"], ["Gerl", "Dallwig", "Chatfield"], ["Torres", "Ellenberger"], ["Loibl"]], bench: ["Enciu", "Schedel"] },
    bots: { on: true, context: "Nguyen ist wieder dabei." },
  },
};

describe("botPrompt", () => {
  it("names the positions, the results and the coach's context", () => {
    const { system, user } = botPrompt(lineup, ["28.10.: 2:2 gegen SV Beispiel"]);
    expect(user).toContain("Tor: Coach");
    expect(user).toContain("Abwehr: Gerl, Dallwig, Chatfield");
    expect(user).toContain("Mittelfeld: Torres, Ellenberger");
    expect(user).toContain("Sturm: Loibl");
    expect(user).toContain("Bank: Enciu, Schedel");
    expect(user).toContain("28.10.: 2:2 gegen SV Beispiel");
    expect(user).toContain("1:7"); // earlier results
    expect(user).toContain("- Nguyen ist wieder dabei");
    expect(system).toMatch(/JSON/);
  });
  it("splits the coach's context into topics that only a few comments pick up", () => {
    const { user } = botPrompt({ ...lineup, data: { ...lineup.data, bots: { on: true, context: "Nguyen ist zurück. Gegner ist Tabellenführer\nPlatz ist nass" } } }, []);
    expect(user).toContain("- Nguyen ist zurück");
    expect(user).toContain("- Gegner ist Tabellenführer");
    expect(user).toContain("- Platz ist nass");
    expect(user).toMatch(/Jedes Thema greifen nur 3 bis 5 Kommentare auf/);
    expect(user).toMatch(/höchstens 5 Kommentare/);
  });
  it("labels a two-row lineup without a midfield", () => {
    const { user } = botPrompt({ ...lineup, data: { ...lineup.data, lineup: { lines: [["Coach"], ["Gerl"]], bench: [] } } }, []);
    expect(user).toContain("Tor: Coach");
    expect(user).toContain("Feld: Gerl");
  });
});

describe("parseBots", () => {
  const list = [{ name: "Schnösel4Life", text: "Endlich wieder Loibl vorne!", minute: 2 }, { name: "Kabinenfunk", text: "Genau", minute: 4, replyTo: 0 }];
  it("reads a clean JSON list", () => {
    expect(parseBots(JSON.stringify(list))).toEqual(list);
  });
  it("finds the list inside code fences or prose", () => {
    expect(parseBots("Hier sind die Kommentare:\n```json\n" + JSON.stringify(list) + "\n```\nViel Spaß!")).toEqual(list);
  });
  it("drops what it can't use and clamps the minute", () => {
    const out = parseBots(JSON.stringify([
      { name: "", text: "ohne Namen", minute: 1 },
      { name: "A", text: "  ", minute: 1 },
      { name: "Zu lang", text: "x".repeat(400), minute: 1 },
      { name: "Spät", text: "nach dem Spiel", minute: 95 },
      { name: "Früh", text: "vorher", minute: -3, replyTo: 7 },
    ]));
    expect(out).toEqual([
      { name: "Spät", text: "nach dem Spiel", minute: 18 },
      { name: "Früh", text: "vorher", minute: 0 },
    ]);
  });
  it("gives nothing for junk", () => {
    expect(parseBots("Tut mir leid, das kann ich nicht.")).toEqual([]);
    expect(parseBots("[{oops")).toEqual([]);
  });
  it("hangs a reply to a reply under the first comment (threads are one level deep)", () => {
    const out = parseBots(JSON.stringify([{ name: "A", text: "a", minute: 1 }, { name: "B", text: "b", minute: 2, replyTo: 0 }, { name: "C", text: "c", minute: 3, replyTo: 1 }]));
    expect(out[2]).toEqual({ name: "C", text: "c", minute: 3, replyTo: 0 });
  });
  it("keeps replies only to earlier comments of the list", () => {
    const out = parseBots(JSON.stringify([{ name: "A", text: "a", minute: 1, replyTo: 1 }, { name: "B", text: "b", minute: 2, replyTo: 0 }]));
    expect(out).toEqual([{ name: "A", text: "a", minute: 1 }, { name: "B", text: "b", minute: 2, replyTo: 0 }]);
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
    const answer = await askModel({ url: "https://llm.example/api", key: "k", model: "m" }, { system: "s", user: "u" }, fetcher);
    expect(answer).toBe("[]");
    expect(sent?.url).toBe("https://llm.example/api/chat/completions");
    expect(sent?.auth).toBe("Bearer k");
    expect(sent?.body.model).toBe("m");
    expect(sent?.body.messages.map((m) => m.role)).toEqual(["system", "user"]);
  });
  it("fails on an error status", async () => {
    const fetcher = (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
    await expect(askModel({ url: "https://x", key: "k", model: "m" }, { system: "s", user: "u" }, fetcher)).rejects.toThrow();
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

describe("botPrompt options", () => {
  it("asks for the batch's number of comments, a few comparisons with known pros, and knows what's already there", () => {
    const { system, user } = botPrompt(lineup, [], { count: 10, topics: ["Platz ist nass"], existing: ["Kabinenfunk: Ohne Nguyen wird's schwer"] });
    expect(system).toContain("JSON-Array mit 10 Objekten");
    expect(system).toMatch(/Genau 1 Kommentar vergleicht .*bekannten Profi/);
    expect(user).toContain("- Platz ist nass");
    expect(user).not.toContain("Nguyen ist wieder dabei"); // only this batch's topics
    expect(user).toContain("Kabinenfunk: Ohne Nguyen wird's schwer");
    expect(user).toMatch(/nicht wiederholen/);
  });
});

describe("batchPlan", () => {
  it("splits the comments into batches of up to 10 and deals the topics out", () => {
    expect(batchPlan(30, ["a", "b", "c", "d"])).toEqual([
      { count: 10, topics: ["a", "d"] }, { count: 10, topics: ["b"] }, { count: 10, topics: ["c"] },
    ]);
    expect(batchPlan(25, [])).toEqual([{ count: 9, topics: [] }, { count: 8, topics: [] }, { count: 8, topics: [] }]);
  });
});

describe("askModel streaming", () => {
  it("reads the answer as it streams in (so the connection never sits idle)", async () => {
    let body: { stream?: boolean } = {};
    const sse = ['data: {"choices":[{"delta":{"role":"assistant"}}]}', 'data: {"choices":[{"delta":{"content":"[{\\"a\\""}}]}', 'data: {"choices":[{"delta":{"content":":1}]"}}]}', "data: [DONE]", ""].join("\n\n");
    const fetcher = (async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return new Response(sse, { headers: { "content-type": "text/event-stream" } });
    }) as typeof fetch;
    expect(await askModel({ url: "https://x/api", key: "k", model: "m" }, { system: "s", user: "u" }, fetcher)).toBe('[{"a":1}]');
    expect(body.stream).toBe(true);
  });
});

describe("comparisons", () => {
  it("about one in ten compares a player with a pro, so the batches don't add up to too many", () => {
    expect(botPrompt(lineup, [], { count: 30 }).system).toMatch(/Genau 3 Kommentare vergleichen/);
    expect(botPrompt(lineup, [], { count: 8 }).system).toMatch(/Genau 1 Kommentar vergleicht/);
  });
});

describe("mood and limits", () => {
  it("tells the model the post's mood", () => {
    const angry = { ...lineup, data: { ...lineup.data, bots: { on: true, mood: "wuetend" as const } } };
    expect(botPrompt(angry, []).system).toMatch(/Stimmung: wütend/);
    expect(botPrompt(lineup, []).system).toMatch(/Stimmung: gemischt/);
  });
  it("forbids remarks on looks, weight and origin, also when the coach's notes have them", () => {
    const { system } = botPrompt(lineup, []);
    expect(system).toMatch(/Aussehen, Gewicht, Herkunft/);
    expect(system).toMatch(/auch wenn es in den Infos steht/);
  });
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
    expect(out.map((c) => c.name)).toEqual(["C", "D", "G"]);
  });
});

describe("botCount", () => {
  it("is a different number each time, between 25 and 42", async () => {
    const { botCount } = await import("./coachBots.ts");
    expect(botCount(() => 0)).toBe(25);
    expect(botCount(() => 0.9999)).toBe(42);
    expect(botCount(() => 0.5)).toBe(34);
  });
});

describe("names", () => {
  it("asks for mixed, unpatterned names", () => {
    const { system } = botPrompt(lineup, []);
    expect(system).toMatch(/Namen bunt gemischt/);
    expect(system).toMatch(/kein Muster/);
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

describe("no bots under teammates' names", () => {
  it("drops comments whose name contains a player's name, from the post or the squad", async () => {
    const { playerNames } = await import("./coachBots.ts");
    const names = playerNames(lineup);
    expect(names).toEqual(expect.arrayContaining(["gerl", "loibl", "nguyen", "kowol"]));
    const out = parseBots(JSON.stringify([
      { name: "KevinN88", text: "Letztes Mal fehlte ich", minute: 1 },
      { name: "der_ellenberger", text: "1:7 war hart", minute: 2 },
      { name: "basti91", text: "Loibl am Limit", minute: 3 },
      { name: "Nguyen_Fan", text: "Kevin wo bist du", minute: 4 },
    ]), names);
    expect(out.map((c) => c.name)).toEqual(["basti91"]);
  });
  it("tells the model not to use teammates' names and not to copy the example", () => {
    const { system } = botPrompt(lineup, []);
    expect(system).toMatch(/nie die Namen unserer Spieler/);
    expect(system).toMatch(/eigene Vergleiche, nicht das Beispiel/);
  });
});

describe("modelFromEnv", () => {
  it("prefers the LLM_* settings (e.g. Grok) and falls back to Morpheus", async () => {
    const { modelFromEnv } = await import("./coachBots.ts");
    const morpheus = { MORPHEUS_API_KEY: "m", MORPHEUS_BASE_URL: "https://morpheus/api", MORPHEUS_MODEL: "qwen" };
    expect(modelFromEnv(morpheus)).toEqual({ url: "https://morpheus/api", key: "m", model: "qwen" });
    expect(modelFromEnv({ ...morpheus, LLM_API_KEY: "x", LLM_BASE_URL: "https://api.x.ai/v1", LLM_MODEL: "grok" })).toEqual({ url: "https://api.x.ai/v1", key: "x", model: "grok" });
    expect(modelFromEnv({ LLM_API_KEY: "x" })).toBeUndefined();
  });
});
