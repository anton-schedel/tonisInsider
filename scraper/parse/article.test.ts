import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArticle } from "./article.ts";
import type { ArticleRef } from "../types.ts";

const fx = (name: string) => readFileSync(join(import.meta.dirname, "..", "__fixtures__", name), "utf8");
const NOW = new Date("2026-10-07T09:00:00Z");
const ref = (id: number, headline = "List headline"): ArticleRef => ({
  id, url: `https://www.ligainsider.de/x_1/y-${id}/`, headline, newsType: "verletzung",
});

describe("parseArticle", () => {
  it("parses a player article", () => {
    const a = parseArticle(fx("article-kobel.html"), ref(418778), "bundesliga", NOW);
    expect(a.headline).toBe("Kobel kann sich langfristigen BVB-Verbleib vorstellen");
    expect(a.listHeadline).toBe("List headline");
    expect(a.player).toEqual({ id: 9357, slug: "gregor-kobel", name: "Gregor Kobel" });
    expect(a.club).toEqual({ id: 14, slug: "borussia-dortmund", name: "Borussia Dortmund" });
    expect(a.author).toBe("Robin Meise");
    expect(a.publishedAt).toBe("2026-10-07T07:32:00.000Z");
    expect(a.source?.name).toBe("bild.de");
    expect(a.source?.url).toMatch(/^https:\/\/www\.bild\.de\//);
    expect(a.newsType).toBe("verletzung");
    expect(a.category).toBe("bundesliga");
    expect(a.fetchedAt).toBe(NOW.toISOString());
  });

  it("reads the banner photo and asks for a 1200 px version (credit overlay kept)", () => {
    const a = parseArticle(fx("article-kobel.html"), ref(418778), "bundesliga", NOW);
    expect(a.banner).toMatch(/^https:\/\/cdn\.ligainsider\.com\/ligainsider\/\/newsarticle\/tr:w-1200,q-80,fo-top,l-text,i-%C2%A9Hendrik/);
    expect(a.banner).toMatch(/\/gregor-kobel-borussia-dortmund-2025-2026\.jpg\?updatedAt=1763054344030$/);
    expect(parseArticle(fx("article-pk-termine.html"), ref(1), "bundesliga", NOW).banner).toMatch(/w-1200,q-80/);
  });

  it("marks a missing banner as null (so it isn't looked for again)", () => {
    expect(parseArticle("<html></html>", ref(1), "bundesliga", NOW).banner).toBeNull();
  });

  it("keeps the full body with formatting but without the ad slot", () => {
    const a = parseArticle(fx("article-kobel.html"), ref(418778), "bundesliga", NOW);
    expect(a.bodyHtml.startsWith("<p>Gregor Kobel kann sich gut vorstellen")).toBe(true);
    expect(a.bodyHtml).toContain("<i>Sport Bild</i>");
    expect(a.bodyHtml).toContain("Waldemar Anton und Julian Ryerson");
    expect(a.bodyHtml).not.toContain("ad_oop");
    expect(a.bodyHtml).not.toContain("DURCHSCHNITTSNOTE");
    expect(a.bodyHtml.match(/<p>/g)).toHaveLength(4);
  });

  it("does not treat the LigaInsider editorial account as a player", () => {
    const a = parseArticle(fx("article-pk-termine.html"), ref(418731), "bundesliga", NOW);
    expect(a.headline).toBe("5. Spieltag: Die PK-Termine in der Übersicht");
    expect(a.player).toBeUndefined();
    expect(a.club).toBeUndefined();
    expect(a.bodyHtml).toContain("<h3>Die PK-Termine in der Übersicht</h3>");
    expect(a.bodyHtml).toContain('<a href="https://www.youtube.com/');
  });

  it("takes the player from the URL when the header names only the club", () => {
    const html = `<div class="news_title_box"><strong><a href="/hamburger-sv/9/">Hamburger SV</a></strong><h2>HSV-Abwehr</h2></div>`;
    const withPlayer = { ...ref(418850), url: "https://www.ligainsider.de/sebastiaan-bornauw_18822/hsv-abwehr-418850/", playerName: "Sebastiaan Bornauw" };
    const a = parseArticle(html, withPlayer, "bundesliga", NOW);
    expect(a.player).toEqual({ slug: "sebastiaan-bornauw", id: 18822, name: "Sebastiaan Bornauw" });
    expect(a.club?.slug).toBe("hamburger-sv");
    // LigaInsider's own articles stay without a player.
    const own = { ...ref(418731), url: "https://www.ligainsider.de/ligainsider_1381/pk-termine-418731/", playerName: "LigaInsider" };
    expect(parseArticle(html, own, "bundesliga", NOW).player).toBeUndefined();
  });

  it("returns an empty body and date for a page that is not an article (validation catches it)", () => {
    const a = parseArticle("<html><body>Wartung</body></html>", ref(1, "X"), "bundesliga", NOW);
    expect(a.bodyHtml).toBe("");
    expect(a.publishedAt).toBe("");
    expect(a.headline).toBe("X");
  });
});
