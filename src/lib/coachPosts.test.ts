import { describe, expect, it } from "vitest";
import { confirmedLineup } from "./lineupNews.ts";
import { slug, toArticle, validate, type CoachPost } from "./coachPosts.ts";

const NOW = new Date("2026-10-24T12:00:00.000Z");

const post = (over: Partial<CoachPost> & Pick<CoachPost, "type" | "data">): CoachPost => ({
  id: 900_001_000, publishedAt: "2026-10-24T17:00:00.000Z", updatedAt: "2026-10-24T12:00:00.000Z", ...over,
});

describe("toArticle", () => {
  it("builds a lineup post whose XI the feed shows", () => {
    const a = toArticle(post({
      type: "lineup",
      data: { headline: "Aufstellung des TuS Schnöselmob", lineup: { lines: [["Coach"], ["Gerl", "Dallwig"], ["Torres"]], bench: ["Enciu", "Schedel"] } },
      pinnedUntil: "2026-10-24T18:00:00.000Z",
    }));
    expect(a.url).toBe("/tus-schnoeselmob/aufstellung-des-tus-schnoeselmob-900001000/");
    expect(confirmedLineup(a)).toEqual({ xi: "Coach – Gerl, Dallwig – Torres", bench: "Enciu, Schedel" });
    expect(a).toMatchObject({ id: 900_001_000, own: true, pinnedUntil: "2026-10-24T18:00:00.000Z" });
    expect(a.club?.name).toBe("TuS Schnöselmob");
  });

  it("builds a result post with the score in the body, an away one the other way round", () => {
    const a = toArticle(post({
      type: "result",
      data: { headline: "Endlich! Schnöselmob holt den ersten Sieg", text: "Starke Leistung.\n\nVerdient.", result: { opponent: "FC Förderbedarf", ours: 3, theirs: 1, home: true } },
    }));
    expect(a.headline).toBe("Endlich! Schnöselmob holt den ersten Sieg");
    expect(a.url).toBe("/tus-schnoeselmob/endlich-schnoeselmob-holt-den-ersten-sieg-900001000/");
    expect(a.bodyHtml).toContain("<b>TuS Schnöselmob – FC Förderbedarf 3:1</b>");
    expect(a.bodyHtml).toContain("<p>Starke Leistung.</p>\n<p>Verdient.</p>");
    const away = toArticle(post({ type: "result", data: { headline: "Niederlage", result: { opponent: "AS Tralkörper", ours: 1, theirs: 7, home: false } } }));
    expect(away.bodyHtml).toContain("AS Tralkörper – TuS Schnöselmob 7:1");
  });

  it("builds player news with the photo as avatar and banner", () => {
    const a = toArticle(post({
      type: "player",
      data: { headline: "Nguyen fehlt", text: "Leider.", player: { name: "Kevin Nguyen", newsType: "angeschlagen" } },
      image: { id: "ab12cd34ef56ab78", width: 900, height: 1200 },
    }));
    expect(a.player).toEqual({ id: 900_001_000, slug: "kevin-nguyen", name: "Kevin Nguyen", photo: "/img/custom/coach/ab12cd34ef56ab78.jpg" });
    expect(a.banner).toBe("/img/custom/coach/ab12cd34ef56ab78.jpg");
  });

  it("escapes what the coach typed", () => {
    const a = toArticle(post({ type: "lineup", data: { headline: "A<b>", text: "x & <script>", lineup: { lines: [["Gör<i>"]], bench: [] } } }));
    expect(a.bodyHtml).not.toContain("<script>");
    expect(a.bodyHtml).toContain("x &amp; &lt;script&gt;");
    expect(a.bodyHtml).toContain("Gör&lt;i&gt;");
    expect(a.headline).toBe("A<b>"); // Astro escapes headlines where it prints them
  });
});

describe("validate", () => {
  const lineup = { type: "lineup", data: { headline: "Aufstellung des TuS Schnöselmob", lineup: { lines: [[" Coach ", ""], [], ["Gerl"]], bench: ["", "Enciu"] } }, publishedAt: "2026-10-24T17:00:00.000Z", pinnedHours: 1 };
  const result = { type: "result", data: { headline: "Ergebnis", result: { opponent: "FC X", ours: 1, theirs: 2, home: true } }, publishedAt: NOW.toISOString(), pinnedHours: 0 };
  const player = { type: "player", data: { headline: "Nguyen fehlt", player: { name: "Kevin Nguyen", newsType: "fit" } }, publishedAt: NOW.toISOString(), pinnedHours: 0 };

  it("accepts a lineup and drops empty names and rows", () => {
    const v = validate(lineup, NOW);
    expect(v).toMatchObject({ type: "lineup", publishedAt: "2026-10-24T17:00:00.000Z", pinnedHours: 1 });
    expect("data" in v && v.data.lineup).toEqual({ lines: [["Coach"], ["Gerl"]], bench: ["Enciu"] });
    expect("error" in validate(result, NOW) || "error" in validate(player, NOW)).toBe(false);
  });
  it.each([
    ["a headline under 3 characters", { ...lineup, data: { ...lineup.data, headline: "ab" } }],
    ["a lineup without a name", { ...lineup, data: { headline: "Aufstellung", lineup: { lines: [[""]], bench: [] } } }],
    ["an impossible score", { ...result, data: { ...result.data, result: { ...result.data.result, ours: 100 } } }],
    ["a result without opponent", { ...result, data: { ...result.data, result: { ...result.data.result, opponent: " " } } }],
    ["an unknown badge", { ...player, data: { ...player.data, player: { name: "Kevin Nguyen", newsType: "kaputt" } } }],
    ["player news without a name", { ...player, data: { ...player.data, player: { name: "", newsType: "fit" } } }],
    ["a time over 60 days ahead", { ...lineup, publishedAt: "2027-01-24T17:00:00.000Z" }],
    ["a pin over a day", { ...lineup, pinnedHours: 25 }],
    ["a broken time", { ...lineup, publishedAt: "morgen" }],
    ["an unknown type", { type: "spam" }],
  ])("refuses %s", (_, input) => {
    expect("error" in validate(input, NOW)).toBe(true);
  });
  it("keeps the bot settings, with a known mood only", () => {
    const v = validate({ ...lineup, data: { ...lineup.data, bots: { on: true, context: "  Zwei Stammspieler fehlten. " } } }, NOW);
    expect("data" in v && v.data.bots).toEqual({ on: true, context: "Zwei Stammspieler fehlten." });
    const mood = (m: string) => validate({ ...result, data: { ...result.data, bots: { on: true, mood: m } } }, NOW);
    const known = mood("wuetend");
    expect("data" in known && known.data.bots).toEqual({ on: true, mood: "wuetend" });
    const unknown = mood("boese");
    expect("data" in unknown && unknown.data.bots).toEqual({ on: true });
  });
});

describe("slug", () => {
  it("slugs German headlines", () => {
    expect(slug("Nicht im Kader: Schnöselmob muss auf Nguyen verzichten!")).toBe("nicht-im-kader-schnoeselmob-muss-auf-nguyen-verzichten");
    expect(slug("Ärger über Maßnahmen")).toBe("aerger-ueber-massnahmen");
  });
});

describe("dueCoach", () => {
  it("builds a scheduled post only shortly before its time", async () => {
    const { dueCoach, COACH_LEAD_MS } = await import("./coachPosts.ts");
    const at = (ms: number) => post({ type: "result", data: { headline: "x" }, publishedAt: new Date(NOW.getTime() + ms).toISOString() });
    expect(dueCoach([at(-86_400_000), at(COACH_LEAD_MS - 1000), at(COACH_LEAD_MS + 60_000), at(2 * 86_400_000)], NOW).map((p) => p.publishedAt))
      .toEqual([at(-86_400_000).publishedAt, at(COACH_LEAD_MS - 1000).publishedAt]);
  });
});
