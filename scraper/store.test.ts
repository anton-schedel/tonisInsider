import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "./store.ts";
import type { Article, Lineup } from "./types.ts";

const article = (id: number): Article => ({
  id, url: "u", headline: "H", listHeadline: "H", category: "bundesliga", newsType: "fit",
  publishedAt: "2026-10-07T07:32:00.000Z", bodyHtml: "<p>x</p>", fetchedAt: "x",
});

describe("Store", () => {
  it("stores, lists and deletes articles", () => {
    const store = new Store(join(mkdtempSync(join(tmpdir(), "ti-")), "store"));
    expect(store.articles()).toEqual([]);
    store.putArticle(article(1));
    store.putArticle(article(2));
    expect(store.getArticle(2)).toEqual(article(2));
    expect(store.articles().map((a) => a.id).sort()).toEqual([1, 2]);
    store.deleteArticle(1);
    expect(store.getArticle(1)).toBeUndefined();
  });

  it("stores lineups by club slug and state", () => {
    const store = new Store(join(mkdtempSync(join(tmpdir(), "ti-")), "store"));
    const lineup = { club: { id: 14, slug: "borussia-dortmund", name: "BVB" }, formation: "", lines: [], updatedAt: "x" } as Lineup;
    store.putLineup(lineup);
    expect(store.getLineup("borussia-dortmund")).toEqual(lineup);
    expect(store.state()).toEqual({});
    store.putState({ lastChangeAt: "y" });
    expect(store.state()).toEqual({ lastChangeAt: "y" });
  });
});
