import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseCommentCounts } from "./commentCounts.ts";
import { parseNewsList } from "./newsList.ts";

const fx = (name: string) => readFileSync(join(import.meta.dirname, "..", "__fixtures__", name), "utf8");

describe("parseCommentCounts", () => {
  const html = fx("news-bundesliga.html");

  it("reads the comment count of every article in the overview", () => {
    const counts = parseCommentCounts(html);
    expect(counts[418778]).toBe(3);
    expect(counts[418775]).toBe(12);
    expect(Object.keys(counts).map(Number).sort()).toEqual(parseNewsList(html).map((r) => r.id).sort());
  });

  it("accepts attributes in any order", () => {
    const a = `<a href="/x/some-title-123456/#comments" class="small_comment_top float-end"><i class="fa fa-comments"></i><small> 7 </small></a>`;
    expect(parseCommentCounts(a)).toEqual({ 123456: 7 });
  });

  it("returns nothing for a page without counts", () => {
    expect(parseCommentCounts("<html></html>")).toEqual({});
  });
});
