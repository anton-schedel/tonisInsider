import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { newestListed, newsWaiting } from "./newsWatch.ts";
import { parseNewsList } from "../../scraper/parse/newsList.ts";

const fx = (name: string) => readFileSync(join(import.meta.dirname, "..", "..", "scraper", "__fixtures__", name), "utf8");

describe("newestListed", () => {
  it("finds the newest article id like the scraper's parser, without parsing the page", () => {
    for (const page of ["news-bundesliga.html", "news-confirmed-lineup.html"]) {
      const html = fx(page);
      expect(newestListed(html)).toBe(Math.max(...parseNewsList(html).map((r) => r.id)));
    }
  });

  it("nothing on a page without articles", () => {
    expect(newestListed("<html><a href=\"/kontakt/\">x</a></html>")).toBeUndefined();
  });
});

describe("newsWaiting", () => {
  it("only a newer article than the site has, once", () => {
    expect(newsWaiting(420290, 420288, undefined)).toBe(true);
    expect(newsWaiting(420288, 420288, undefined)).toBe(false);
    // Already started a run for it (it may be one the scraper skips): not again every minute.
    expect(newsWaiting(420290, 420288, 420290)).toBe(false);
    expect(newsWaiting(420291, 420288, 420290)).toBe(true);
    expect(newsWaiting(undefined, 420288, undefined)).toBe(false);
    expect(newsWaiting(420290, undefined, undefined)).toBe(false);
  });
});
