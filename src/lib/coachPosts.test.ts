import { describe, expect, it } from "vitest";
import { confirmedLineup } from "./lineupNews.ts";
import { escapeHtml, slug, toArticle, validate, type CoachPost } from "./coachPosts.ts";

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
    expect(a).toMatchObject({ id: 900_001_000, own: true, category: "bundesliga", newsType: "sonstiges", pinnedUntil: "2026-10-24T18:00:00.000Z", banner: "/img/custom/schnoeselmob-banner.jpg" });
    expect(a.club?.name).toBe("TuS Schnöselmob");
  });

  it("builds a result post with the score in the body", () => {
    const a = toArticle(post({
      type: "result",
      data: { headline: "Endlich! Schnöselmob holt den ersten Sieg", text: "Starke Leistung.\n\nVerdient.", result: { opponent: "FC Förderbedarf", ours: 3, theirs: 1, home: true } },
    }));
    expect(a.headline).toBe("Endlich! Schnöselmob holt den ersten Sieg");
    expect(a.url).toBe("/tus-schnoeselmob/endlich-schnoeselmob-holt-den-ersten-sieg-900001000/");
    expect(a.bodyHtml).toContain("<b>TuS Schnöselmob – FC Förderbedarf 3:1</b>");
    expect(a.bodyHtml).toContain("<p>Starke Leistung.</p>\n<p>Verdient.</p>");
  });

  it("puts an away result the other way round", () => {
    const a = toArticle(post({ type: "result", data: { headline: "Niederlage", result: { opponent: "AS Tralkörper", ours: 1, theirs: 7, home: false } } }));
    expect(a.bodyHtml).toContain("AS Tralkörper – TuS Schnöselmob 7:1");
  });

  it("builds player news with the photo as avatar and banner", () => {
    const a = toArticle(post({
      type: "player",
      data: { headline: "Nguyen fehlt", text: "Leider.", player: { name: "Kevin Nguyen", newsType: "angeschlagen" } },
      image: { id: "ab12cd34ef56ab78", width: 900, height: 1200 },
    }));
    expect(a.newsType).toBe("angeschlagen");
    expect(a.player).toEqual({ id: 900_001_000, slug: "kevin-nguyen", name: "Kevin Nguyen", photo: "/img/custom/coach/ab12cd34ef56ab78.jpg" });
    expect(a.banner).toBe("/img/custom/coach/ab12cd34ef56ab78.jpg");
    expect(a.bannerSize).toEqual({ width: 900, height: 1200 });
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

  it("accepts a lineup and drops empty names and rows", () => {
    const v = validate(lineup, NOW);
    expect(v).toMatchObject({ type: "lineup", publishedAt: "2026-10-24T17:00:00.000Z", pinnedHours: 1 });
    expect("data" in v && v.data.lineup).toEqual({ lines: [["Coach"], ["Gerl"]], bench: ["Enciu"] });
  });
  it("needs a headline of 3 to 140 characters", () => {
    expect(validate({ ...lineup, data: { ...lineup.data, headline: "ab" } }, NOW)).toEqual({ error: "Die Überschrift braucht 3 bis 140 Zeichen." });
  });
  it("needs at least one name in a lineup", () => {
    expect(validate({ ...lineup, data: { headline: "Aufstellung", lineup: { lines: [[""]], bench: [] } } }, NOW)).toEqual({ error: "Trag mindestens einen Spieler ein." });
  });
  it("checks the score", () => {
    const r = { type: "result", data: { headline: "Ergebnis", result: { opponent: "FC X", ours: 100, theirs: 0, home: true } }, publishedAt: NOW.toISOString(), pinnedHours: 0 };
    expect(validate(r, NOW)).toEqual({ error: "Das Ergebnis stimmt nicht." });
    expect(validate({ ...r, data: { ...r.data, result: { ...r.data.result, ours: 2, opponent: " " } } }, NOW)).toEqual({ error: "Gegen wen wurde gespielt?" });
  });
  it("needs a player name and a known badge", () => {
    const p = { type: "player", data: { headline: "Nguyen fehlt", player: { name: "Kevin Nguyen", newsType: "kaputt" } }, publishedAt: NOW.toISOString(), pinnedHours: 0 };
    expect(validate(p, NOW)).toEqual({ error: "Ungültige Anfrage." });
    expect(validate({ ...p, data: { ...p.data, player: { name: "", newsType: "fit" } } }, NOW)).toEqual({ error: "Welcher Spieler?" });
  });
  it("refuses times far ahead and pins over a day", () => {
    expect(validate({ ...lineup, publishedAt: "2027-01-24T17:00:00.000Z" }, NOW)).toEqual({ error: "Höchstens 60 Tage im Voraus." });
    expect(validate({ ...lineup, pinnedHours: 25 }, NOW)).toEqual({ error: "Anheften geht für 0 bis 24 Stunden." });
    expect(validate({ ...lineup, publishedAt: "morgen" }, NOW)).toEqual({ error: "Ungültige Zeit." });
    expect(validate({ type: "spam" }, NOW)).toEqual({ error: "Ungültige Anfrage." });
  });
  it("keeps the bot settings", () => {
    const v = validate({ ...lineup, data: { ...lineup.data, bots: { on: true, context: "  Zwei Stammspieler fehlten. " } } }, NOW);
    expect("data" in v && v.data.bots).toEqual({ on: true, context: "Zwei Stammspieler fehlten." });
  });
});

describe("helpers", () => {
  it("slugs German headlines", () => {
    expect(slug("Nicht im Kader: Schnöselmob muss auf Nguyen verzichten!")).toBe("nicht-im-kader-schnoeselmob-muss-auf-nguyen-verzichten");
    expect(slug("Ärger über Maßnahmen")).toBe("aerger-ueber-massnahmen");
  });
  it("escapes HTML", () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
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
