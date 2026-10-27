import { describe, expect, it } from "vitest";
import { askModel, batchPlan, botNames, botPrompt, botRows, dropSimilar, parseBots, type BotComment } from "./coachBots.ts";
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
  it("gives nothing for junk", () => {
    expect(parseBots("Tut mir leid, das kann ich nicht.")).toEqual([]);
    expect(parseBots("[{oops")).toEqual([]);
  });
  it("hangs a reply to a reply under the first comment (threads are one level deep)", () => {
    const out = parseBots(JSON.stringify([{ text: "a", minute: 1 }, { text: "b", minute: 2, replyTo: 0 }, { text: "c", minute: 3, replyTo: 1 }]));
    expect(out[2].replyTo).toBe(0);
  });
  it("keeps replies only to earlier comments of the list", () => {
    const out = parseBots(JSON.stringify([{ text: "a", minute: 1, replyTo: 1 }, { text: "b", minute: 2, replyTo: 0 }]));
    expect(out.map((c) => c.replyTo)).toEqual([undefined, 0]);
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

describe("botCount", () => {
  it("is a different number each time, between 25 and 42", async () => {
    const { botCount } = await import("./coachBots.ts");
    expect(botCount(() => 0)).toBe(25);
    expect(botCount(() => 0.9999)).toBe(42);
    expect(botCount(() => 0.5)).toBe(34);
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
    const names = botNames(200, [...words, "max"]);
    expect(names).toHaveLength(200);
    expect(names.filter((n) => words.some((w) => n.toLowerCase().includes(w)) || n.toLowerCase().includes("max"))).toEqual([]);
    expect(new Set(names).size).toBeGreaterThan(150);
    const few = botNames(30).map((n) => n.replace(/[\d_. ].*$/, "").toLowerCase());
    expect(new Set(few).size).toBeGreaterThan(25);
  });
});

describe("modelFromEnv", () => {
  it("prefers the LLM_* settings (e.g. Grok) and falls back to Morpheus", async () => {
    const { modelFromEnv } = await import("./coachBots.ts");
    const morpheus = { MORPHEUS_API_KEY: "m", MORPHEUS_BASE_URL: "https://morpheus/api", MORPHEUS_MODEL: "qwen" };
    expect(modelFromEnv(morpheus)).toEqual({ url: "https://morpheus/api", key: "m", model: "qwen", batch: 10 });
    expect(modelFromEnv({ ...morpheus, LLM_API_KEY: "x", LLM_BASE_URL: "https://api.x.ai/v1", LLM_MODEL: "grok" })).toEqual({ url: "https://api.x.ai/v1", key: "x", model: "grok", batch: 50 });
    expect(modelFromEnv({ LLM_API_KEY: "x" })).toBeUndefined();
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
