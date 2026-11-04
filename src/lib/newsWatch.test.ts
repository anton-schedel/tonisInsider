import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { newestListed, newsWaiting, runRecently } from "./newsWatch.ts";
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
  it("only an article newer than the highest id the scraper knows", () => {
    expect(newsWaiting(420290, 420288)).toBe(true);
    expect(newsWaiting(420288, 420288)).toBe(false);
    // Today's loop: the site's newest by time (420283) is below its highest id (420288); seen compares right.
    expect(newsWaiting(420288, 420288)).toBe(false);
    expect(newsWaiting(undefined, 420288)).toBe(false);
    // A site without `seen` yet (deployed before it): no early runs.
    expect(newsWaiting(420290, undefined)).toBe(false);
  });
});

describe("runRecently", () => {
  const now = Date.parse("2026-11-04T12:10:00Z");
  it("a run queued, running or started in the last 4 minutes holds the next one back", () => {
    expect(runRecently([{ status: "completed", created_at: "2026-11-04T12:07:00Z" }], now)).toBe(true);
    expect(runRecently([{ status: "in_progress", created_at: "2026-11-04T11:50:00Z" }], now)).toBe(true);
    expect(runRecently([{ status: "queued", created_at: "2026-11-04T11:50:00Z" }], now)).toBe(true);
    expect(runRecently([{ status: "completed", created_at: "2026-11-04T12:05:30Z" }], now)).toBe(false);
    expect(runRecently([], now)).toBe(false);
  });
});
