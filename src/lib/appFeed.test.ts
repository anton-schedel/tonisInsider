import { describe, it, expect } from "vitest";
import { appFeed } from "./appFeed.ts";
import type { Article, Lineup } from "../../scraper/types.ts";

const article = (id: number, publishedAt: string, extra: Partial<Article> = {}): Article => ({
  id, url: `https://x/${id}`, headline: `H${id}`, listHeadline: `H${id}`, category: "bundesliga", newsType: "sonstiges",
  publishedAt, bodyHtml: "<p>x</p>", fetchedAt: publishedAt, ...extra,
});
const lineup = { club: { id: 1, slug: "fcb", name: "Bayern" }, formation: "4-4-2", lines: [], updatedAt: "2026-11-01T00:00:00Z" } as Lineup;
const now = new Date("2026-11-03T12:00:00Z");

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
