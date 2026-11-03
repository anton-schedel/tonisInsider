import { describe, it, expect } from "vitest";
import { appFeed } from "./appFeed.ts";
import type { Article, Lineup } from "../../scraper/types.ts";

const article = (id: number, publishedAt: string, extra: Partial<Article> = {}): Article => ({
  id, url: `https://x/${id}`, headline: `H${id}`, listHeadline: `H${id}`, category: "bundesliga", newsType: "sonstiges",
  publishedAt, bodyHtml: "<p>x</p>", fetchedAt: publishedAt, ...extra,
});
const lineup = { club: { id: 1, slug: "fcb", name: "Bayern" }, formation: "4-4-2", lines: [], updatedAt: "2026-11-01T00:00:00Z" } as Lineup;
const now = new Date("2026-11-03T12:00:00Z");

const club = (id: number, slug: string, name: string, opponent: string, home: boolean): Lineup => ({
  club: { id, slug, name }, opponent: { name: opponent, home }, matchday: 10, kickoff: "2026-11-07T14:30:00.000Z", formation: "4-4-2",
  lines: [[{ id: id * 10, slug: `p${id}`, name: `Spieler ${id}`, status: "set", alternative: { id: id * 10 + 1, slug: `a${id}`, name: `Alt ${id}` } }]],
  updatedAt: "2026-11-03T00:00:00Z",
});

describe("appFeed fixtures", () => {
  const bayern = club(1, "fc-bayern-muenchen", "FC Bayern München", "1. FC Köln", true);
  const koeln = club(2, "1-fc-koeln", "1. FC Köln", "FC Bayern München", false);
  const odds = [{ home: "Bayern Munich", away: "FC Koln", kickoff: "2026-11-07T14:30:00Z", chances: { home: 78, draw: 13, away: 9 }, books: 20 }];

  it("pairs the clubs with chances, the likely score and clean sheets", () => {
    const feed = appFeed({ articles: [], pinned: [], lineups: [bayern, koeln], state: { odds }, now });
    expect(feed.fixtures).toHaveLength(1);
    const f = feed.fixtures[0]!;
    expect([f.home, f.away, f.homeName, f.awayName]).toEqual(["fc-bayern-muenchen", "1-fc-koeln", "FC Bayern München", "1. FC Köln"]);
    expect(f.chances).toEqual({ home: 78, draw: 13, away: 9 });
    expect(f.tip!.home).toBeGreaterThan(f.tip!.away);
    expect(f.cleanSheet!.home).toBeGreaterThan(f.cleanSheet!.away);
  });

  it("names a fixture without odds and no insights then", () => {
    const feed = appFeed({ articles: [], pinned: [], lineups: [bayern, koeln], state: {}, now });
    expect(feed.fixtures[0]!.chances).toBeUndefined();
    expect(feed.insights).toEqual({});
  });

  it("marks confirmed lineups", () => {
    const post = { id: 1, url: "https://www.ligainsider.de/aufstellung-des-fc-bayern-muenchen_1/", headline: "x", listHeadline: "x",
      category: "bundesliga", newsType: "sonstiges", club: { id: 1, slug: "fc-bayern-muenchen", name: "FC Bayern München" },
      publishedAt: "2026-11-07T13:30:00.000Z", bodyHtml: "<p>Startelf: A</p>", fetchedAt: "" } as Article;
    expect(appFeed({ articles: [post], pinned: [], lineups: [bayern, koeln], state: {}, now }).confirmed).toEqual([1]);
  });
});

describe("appFeed", () => {
  it("keeps the feed order and pinned ids", () => {
    const a = [article(3, "2026-11-03T10:00:00Z"), article(2, "2026-11-02T10:00:00Z"), article(1, "2026-11-01T10:00:00Z")];
    const feed = appFeed({ articles: a, pinned: [a[2]!, a[1]!], lineups: [lineup], state: {}, now });
    expect(feed.articles.map((x) => x.id)).toEqual([3, 2, 1]);
    expect(feed.pinned).toEqual([1, 2]);
    expect(feed.lineups).toEqual([lineup]);
    expect(feed.generatedAt).toBe(now.toISOString());
    expect(feed.version).toBe(1);
  });

  it("includes own and coach posts", () => {
    const own = article(900000001, "2026-11-03T11:00:00Z", { own: true });
    expect(appFeed({ articles: [own], pinned: [], lineups: [], state: {}, now }).articles[0]?.own).toBe(true);
  });

  it("carries comment counts and odds", () => {
    const odds = [{ id: "e1" }] as never;
    const feed = appFeed({ articles: [], pinned: [], lineups: [], state: { commentCounts: { "5": 12 }, odds }, now });
    expect(feed.commentCounts).toEqual({ "5": 12 });
    expect(feed.odds).toBe(odds);
  });
});
