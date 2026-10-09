import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { COMMENTS_TTL_SECONDS, COUNTS_URL, commentCountsResponse, commentsResponse, commentsUrl, cursorFrom, fetchComments, fetchMoreComments, hedged, MORE_URL, parseComments, withoutViewer, type EdgeCache } from "./comments.ts";

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
      vote: 0,
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
      voted: false,
      votingId: 133652,
      options: [
        { label: "Ja", pct: 40, id: 339164 },
        { label: "Nein", pct: 60, id: 339165 },
      ],
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
    // The fresh copy plus the day-long fallback.
    expect([...store.keys()].sort()).toEqual(["https://comments.cache/418776", "https://comments.cache/418776?stale"]);
  });

  it("serves the cached copy without asking LigaInsider again", async () => {
    const { cache } = memoryCache();
    const f = countingFetch(ok);
    await commentsResponse("418776", f.fn, cache);
    const again = await commentsResponse("418776", f.fn, cache);
    expect(f.calls()).toBe(1);
    expect((await again.json()).total).toBe(8);
  });

  it("does not cache a personal (logged-in) response", async () => {
    const { cache, store } = memoryCache();
    const f = countingFetch(ok);
    const res = await commentsResponse("418776", f.fn, cache, { personal: true });
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    // Only the fallback copy, and that one without the viewer's votes.
    expect([...store.keys()]).toEqual(["https://comments.cache/418776?stale"]);
    expect((await res.json()).total).toBe(8);
  });

  it("serves the last good copy when LigaInsider fails, marked as stale", async () => {
    const { cache, store } = memoryCache();
    await commentsResponse("418776", countingFetch(ok).fn, cache);
    store.delete("https://comments.cache/418776"); // the two-minute copy expired
    const res = await commentsResponse("418776", countingFetch(() => new Response("x", { status: 500 })).fn, cache);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-stale")).toBe("1");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect((await res.json()).total).toBe(8);
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

describe("withoutViewer", () => {
  it("drops the viewer's own votes, also in replies and polls", () => {
    const c = { id: 1, user: "a", date: "", text: "", score: 3, vote: 1, poll: { question: "q", total: 2, voted: true, options: [] },
      replies: [{ id: 2, user: "b", date: "", text: "", score: 1, vote: 1, replies: [] }] };
    const out = withoutViewer({ total: 2, comments: [c] });
    expect(out.comments[0]).toMatchObject({ vote: 0, score: 3, poll: { voted: false } });
    expect(out.comments[0].replies[0].vote).toBe(0);
  });
});

describe("hedged", () => {
  it("starts a second try when the first is slow, and the faster one wins", async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    let n = 0;
    const run = (signal: AbortSignal) => {
      signals.push(signal);
      const me = ++n;
      return new Promise<string>((resolve) => setTimeout(() => resolve(`try ${me}`), me === 1 ? 10_000 : 500));
    };
    const result = hedged(run, 2500, 15_000);
    await vi.advanceTimersByTimeAsync(3000);
    expect(await result).toBe("try 2");
    expect(signals[0].aborted).toBe(true); // the slow one is cancelled
    vi.useRealTimers();
  });

  it("doesn't start a second try when the first is quick", async () => {
    let n = 0;
    expect(await hedged(async () => (n++, "ok"), 2500, 15_000)).toBe("ok");
    expect(n).toBe(1);
  });

  it("retries at once when the first try fails, and fails when both do", async () => {
    let n = 0;
    expect(await hedged(async () => { if (n++ === 0) throw new Error("x"); return "second"; }, 2500, 15_000)).toBe("second");
    await expect(hedged(async () => { throw new Error("down"); }, 2500, 15_000)).rejects.toThrow("down");
  });

  it("gives up at the deadline", async () => {
    vi.useFakeTimers();
    const result = hedged(() => new Promise<string>(() => {}), 2500, 15_000);
    const check = expect(result).rejects.toThrow("timeout");
    await vi.advanceTimersByTimeAsync(15_000);
    await check;
    vi.useRealTimers();
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

describe("more comments", () => {
  it("reads where the next batch starts", () => {
    const first = parseComments(fixture("comments-long.html"));
    expect(first.comments).toHaveLength(15);
    expect(first.more).toEqual({ offset: 15, goffset: 15, moffset: 0, cursor: 7851373 });
  });

  it("parses a further batch and its own next cursor", () => {
    const next = parseComments(fixture("comments-more.html"));
    expect(next.comments.length).toBeGreaterThan(0);
    expect(next.more?.offset).toBeGreaterThan(15);
  });

  it("posts the cursor like LigaInsider's own list, newest first", async () => {
    let sent: { url: string; body: string } | undefined;
    const fetchFn = (async (url: string, init: RequestInit) => {
      sent = { url, body: String(init.body) };
      return new Response(fixture("comments-more.html"));
    }) as unknown as typeof fetch;
    await fetchMoreComments(fetchFn, 418926, { offset: 15, goffset: 15, moffset: 0, cursor: 7851373 });
    expect(sent?.url).toBe(MORE_URL);
    expect(Object.fromEntries(new URLSearchParams(sent!.body))).toMatchObject({ offset: "15", commentsbefore: "7851373", tmid: "418926", sort: "newest" });
  });

  it("accepts only numeric cursors from the query", () => {
    expect(cursorFrom(new URLSearchParams("offset=15&goffset=15&moffset=0&cursor=7"))).toEqual({ offset: 15, goffset: 15, moffset: 0, cursor: 7 });
    expect(cursorFrom(new URLSearchParams("offset=15&goffset=x&moffset=0&cursor=7"))).toBeUndefined();
  });
});
