import { describe, it, expect } from "vitest";
import { validateArticle, validateLineup } from "./validate.ts";
import type { Article, Lineup, LineupPlayer } from "./types.ts";

const article: Article = {
  id: 1, url: "u", headline: "H", listHeadline: "H", category: "bundesliga", newsType: "fit",
  publishedAt: "2026-10-07T07:32:00.000Z", bodyHtml: "<p>Ein ausreichend langer Text.</p>", fetchedAt: "x",
};
const player = (id: number): LineupPlayer => ({ id, slug: `p${id}`, name: `P${id}`, status: "set" });
const lineup = (sizes: number[]): Lineup => {
  let id = 0;
  return {
    club: { id: 14, slug: "bvb", name: "BVB" }, formation: "", updatedAt: "x",
    lines: sizes.map((n) => Array.from({ length: n }, () => player(++id))),
  };
};

describe("validateArticle", () => {
  it("accepts a complete article", () => expect(validateArticle(article)).toEqual([]));
  it("rejects missing headline, bad date and empty body", () => {
    expect(validateArticle({ ...article, headline: "", publishedAt: "", bodyHtml: "<p> </p>" })).toEqual([
      "missing headline", "missing or invalid publishedAt", "body too short",
    ]);
  });
});

describe("validateLineup", () => {
  it.each([
    ["accepts 1 + 10 players", [1, 4, 4, 2], []],
    ["rejects 10 players", [1, 4, 4, 1], ["expected 11 players, got 10"]],
    ["rejects two goalkeepers in the first line", [2, 4, 3, 2], ["first line must be exactly one goalkeeper"]],
  ])("%s", (_, sizes, problems) => expect(validateLineup(lineup(sizes))).toEqual(problems));
});
