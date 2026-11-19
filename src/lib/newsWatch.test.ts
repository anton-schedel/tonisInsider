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
  const page = (...ids: number[]) => ids.map((id) => `<a href="/x_1/titel-${id}/">x</a>`).join("");

  it("an article that wasn't on the overview at the scraper's last read, also one with a lower id (they come out of order)", () => {
    const listed = [420911, 420907, 420876];
    expect(newsWaiting(page(420911, 420907, 420876), { seen: 420911, listed })).toBe(false);
    expect(newsWaiting(page(420913, 420911, 420907), { seen: 420911, listed })).toBe(true);
    // 19 Nov: 420888 came out after 420911 and waited for the 5-minute run.
    expect(newsWaiting(page(420888, 420911, 420907), { seen: 420911, listed })).toBe(true);
    // One that left the page is no news.
    expect(newsWaiting(page(420911, 420907), { seen: 420911, listed })).toBe(false);
    expect(newsWaiting("<html></html>", { seen: 420911, listed })).toBe(false);
  });

  it("a site without `listed` yet: only an article newer than the highest id the scraper knows", () => {
    expect(newsWaiting(page(420290), { seen: 420288 })).toBe(true);
    expect(newsWaiting(page(420288, 420283), { seen: 420288 })).toBe(false);
    expect(newsWaiting("<html></html>", { seen: 420288 })).toBe(false);
    // A site without `seen` either (deployed before it): no early runs.
    expect(newsWaiting(page(420290), {})).toBe(false);
  });
});

describe("runRecently", () => {
  const now = Date.parse("2026-11-04T12:37:00Z");
  const run = (created_at: string, status = "completed") => ({ status, created_at });
  it("holds back while a run waits or runs, or right after one started", () => {
    expect(runRecently([run("2026-11-04T11:50:00Z", "in_progress")], now)).toBe(true);
    expect(runRecently([run("2026-11-04T11:50:00Z", "queued")], now)).toBe(true);
    expect(runRecently([run("2026-11-04T12:36:00Z")], now)).toBe(true);
  });

  it("lets one early run in between the 5-minute slots (today's 12:35 article would have been in at 12:37)", () => {
    expect(runRecently([run("2026-11-04T12:35:06Z"), run("2026-11-04T12:30:06Z"), run("2026-11-04T12:25:38Z")], now)).toBe(false);
  });

  it("several early runs between the slots: a burst of posts doesn't wait for the 5-minute run", () => {
    expect(runRecently([run("2026-11-04T12:35:06Z"), run("2026-11-04T12:33:25Z"), run("2026-11-04T12:31:45Z"), run("2026-11-04T12:30:06Z"), run("2026-11-04T12:28:00Z")], now)).toBe(false);
  });

  it("no more than 6 runs in 10 minutes: a check that's wrong costs at most four extra runs", () => {
    expect(runRecently([run("2026-11-04T12:35:06Z"), run("2026-11-04T12:33:25Z"), run("2026-11-04T12:31:45Z"), run("2026-11-04T12:30:06Z"), run("2026-11-04T12:28:45Z"), run("2026-11-04T12:27:25Z")], now)).toBe(true);
  });
});
