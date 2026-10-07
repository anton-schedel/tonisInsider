import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { COMMENTS_TTL_SECONDS, COUNTS_URL, commentCountsResponse, commentsResponse, commentsUrl, fetchComments, parseComments, type EdgeCache } from "./comments.ts";

const fixture = (name: string) => readFileSync(new URL(`../../scraper/__fixtures__/${name}`, import.meta.url), "utf8");

describe("parseComments", () => {
  const poll = parseComments(fixture("comments-poll.html"));
  const paged = parseComments(fixture("comments-paged.html"));

  it("reads the total and the threads in LigaInsider's order (newest first)", () => {
    expect(poll.total).toBe(8);
    expect(poll.comments.map((c) => c.user)).toEqual(["heini.karl", "Jan.jns01", "Vedo63", "BenjiEwald77"]);
  });

  it("reads user, time, text and score of a comment", () => {
    expect(poll.comments[0]).toMatchObject({
      id: 7840463,
      user: "heini.karl",
      date: "2026-10-07T08:12:49.000Z",
      text: "Trotzdem 2,5M gemacht mit dem bre, absurde LSP",
      score: 6,
    });
  });

  it("nests replies under their comment", () => {
    expect(poll.comments[0].replies).toHaveLength(1);
    expect(poll.comments[0].replies[0]).toMatchObject({ user: "Caretsasbahn", text: "Dieses Jahr echt verrückt mit den Marktwerten, ohne sinn", score: 2, replies: [] });
    const all = paged.comments.flatMap((c) => [c, ...c.replies]);
    expect(all.some((c) => c.text.startsWith("Was meint ihr soll ich ihn verkaufen"))).toBe(true);
  });

  it("reads polls with their results", () => {
    expect(poll.comments[1].poll).toEqual({
      question: "Doan verkaufen und beier holen?",
      total: 47,
      options: [{ label: "Ja", pct: 40 }, { label: "Nein", pct: 60 }],
    });
  });

  it("keeps the first page only and still reports the full total", () => {
    expect(paged.total).toBe(27);
    expect(paged.comments).toHaveLength(15);
  });

  it("returns no comments for an empty or unknown page", () => {
    expect(parseComments("<html></html>")).toEqual({ total: 0, comments: [] });
  });

  it("returns plain text, never markup", () => {
    const html = `<div data-comment-count>1</div><li class="comment-card-v2" data-comment-id="1" data-comment-date="Wed, 07 Oct 2026 08:12:49 UTC" data-depth="0"><a class="comment-card-v2__username">x</a><p class="comment-card-v2__text">a <img src=x onerror=alert(1)> &lt;b&gt;</p><span data-score-display>1</span></li>`;
    expect(parseComments(html).comments[0].text).toBe("a <b>");
  });

  it("keeps line breaks inside a comment", () => {
    const html = `<li class="comment-card-v2" data-comment-id="1" data-depth="0"><p class="comment-card-v2__text">Zeile 1<br>  Zeile 2 </p></li>`;
    expect(parseComments(html).comments[0].text).toBe("Zeile 1\nZeile 2");
  });
});

describe("fetchComments", () => {
  it("requests LigaInsider's comment fragment for the article", async () => {
    const urls: string[] = [];
    const fn = (async (url: string | URL | Request) => {
      urls.push(String(url));
      return new Response(fixture("comments-poll.html"));
    }) as typeof fetch;
    const r = await fetchComments(fn, 418776);
    expect(urls).toEqual([commentsUrl(418776)]);
    expect(commentsUrl(418776)).toBe("https://www.ligainsider.de/apiesi/desktop/newscomments/?newsid=418776");
    expect(r.total).toBe(8);
  });

  it("throws when LigaInsider answers with an error", async () => {
    const fn = (async () => new Response("nope", { status: 503 })) as typeof fetch;
    await expect(fetchComments(fn, 1)).rejects.toThrow("HTTP 503");
  });

  it("caches for two minutes", () => {
    expect(COMMENTS_TTL_SECONDS).toBe(120);
  });
});

describe("commentsResponse", () => {
  function memoryCache() {
    const store = new Map<string, Response>();
    const cache: EdgeCache = {
      match: async (key) => store.get(String(key))?.clone(),
      put: async (key, res) => void store.set(String(key), res.clone()),
    };
    return { cache, store };
  }
  function countingFetch(res: () => Response) {
    let calls = 0;
    const fn = (async () => (calls++, res())) as typeof fetch;
    return { fn, calls: () => calls };
  }
  const ok = () => new Response(fixture("comments-poll.html"));

  it("answers with JSON and caches it for two minutes", async () => {
    const { cache, store } = memoryCache();
    const res = await commentsResponse("418776", countingFetch(ok).fn, cache);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("cache-control")).toBe("public, max-age=120");
    expect((await res.json()).total).toBe(8);
    expect(store.size).toBe(1);
  });

  it("serves the cached copy without asking LigaInsider again", async () => {
    const { cache } = memoryCache();
    const f = countingFetch(ok);
    await commentsResponse("418776", f.fn, cache);
    const again = await commentsResponse("418776", f.fn, cache);
    expect(f.calls()).toBe(1);
    expect((await again.json()).total).toBe(8);
  });

  it("rejects ids that aren't article numbers without fetching", async () => {
    const f = countingFetch(ok);
    for (const id of ["abc", "1/../2", "", "1234567890"]) expect((await commentsResponse(id, f.fn)).status).toBe(404);
    expect(f.calls()).toBe(0);
  });

  it("answers 502 and caches nothing when LigaInsider fails", async () => {
    const { cache, store } = memoryCache();
    const res = await commentsResponse("418776", countingFetch(() => new Response("x", { status: 500 })).fn, cache);
    expect(res.status).toBe(502);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(store.size).toBe(0);
  });

  it("answers 502 when the network fails", async () => {
    const fn = (async () => { throw new TypeError("network"); }) as typeof fetch;
    expect((await commentsResponse("418776", fn)).status).toBe(502);
  });
});

describe("commentCountsResponse", () => {
  it("answers with the counts of LigaInsider's newest articles, cached", async () => {
    const urls: string[] = [];
    const fn = (async (url: string | URL | Request) => (urls.push(String(url)), new Response(fixture("news-bundesliga.html")))) as typeof fetch;
    const store = new Map<string, Response>();
    const cache: EdgeCache = { match: async (k) => store.get(k)?.clone(), put: async (k, r) => void store.set(k, r.clone()) };
    const res = await commentCountsResponse(fn, cache);
    expect(COUNTS_URL).toBe("https://www.ligainsider.de/bundesliga-news/uebersicht/");
    expect(urls).toEqual([COUNTS_URL]);
    expect(res.headers.get("cache-control")).toBe("public, max-age=120");
    expect((await res.json())["418778"]).toBe(3);
    await commentCountsResponse(fn, cache);
    expect(urls).toHaveLength(1);
  });

  it("answers 502 when LigaInsider fails", async () => {
    const fn = (async () => new Response("x", { status: 500 })) as typeof fetch;
    expect((await commentCountsResponse(fn)).status).toBe(502);
  });
});
