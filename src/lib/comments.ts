import { load, type CheerioAPI } from "cheerio/slim";
import type { Element } from "domhandler";
import { USER_AGENT } from "../../scraper/fetch.ts";
import { parseCommentCounts } from "../../scraper/parse/commentCounts.ts";

/** LigaInsider comments are fetched live per article view and cached this long at the edge. */
export const COMMENTS_TTL_SECONDS = 120;
/** The last good copy is kept this long and shown when LigaInsider doesn't answer. */
export const STALE_SECONDS = 24 * 60 * 60;
/**
 * LigaInsider's answer times are random (measured 0.3 s to 12 s for the same article, nothing cached on
 * their side). If the first request hasn't answered after HEDGE_AFTER_MS a second one starts in parallel
 * and the faster wins; both together give up after TIMEOUT_MS.
 */
export const HEDGE_AFTER_MS = 2500;
const TIMEOUT_MS = 15000;
const HEADERS = { "user-agent": USER_AGENT, "accept-language": "de-DE,de;q=0.9" };

export type Poll = {
  question: string;
  total: number;
  /** True once this viewer has voted. Results stay hidden until then. */
  voted: boolean;
  /** LigaInsider voting id, present when the poll can be voted on. */
  votingId?: number;
  options: { label: string; pct: number; id?: number }[];
};
export type Comment = {
  id: number;
  user: string;
  /** ISO */
  date: string;
  /** Plain text, never HTML. */
  text: string;
  score: number;
  /** This viewer's vote: -1, 0 or 1. Anonymous pages are always 0. */
  vote: number;
  poll?: Poll;
  replies: Comment[];
};
/** total counts all comments incl. replies; comments holds only LigaInsider's first page. */
export type Comments = { total: number; comments: Comment[] };

export const commentsUrl = (articleId: number) =>
  `https://www.ligainsider.de/apiesi/desktop/newscomments/?newsid=${articleId}`;

/** Runs `run`, and a second copy in parallel if the first is slow (or fails early); the first success wins. */
export function hedged<T>(run: (signal: AbortSignal) => Promise<T>, afterMs = HEDGE_AFTER_MS, timeoutMs = TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const attempts: AbortController[] = [];
    let failed = 0;
    let done = false;
    const end = (ok: boolean, value: unknown) => {
      if (done) return;
      done = true;
      clearTimeout(second);
      clearTimeout(deadline);
      for (const a of attempts) a.abort();
      if (ok) resolve(value as T);
      else reject(value);
    };
    const start = () => {
      const attempt = new AbortController();
      attempts.push(attempt);
      run(attempt.signal).then(
        (value) => end(true, value),
        (err) => {
          failed++;
          if (attempts.length === 1) start(); // the first one failed fast: don't wait for the timer
          else if (failed >= attempts.length) end(false, err);
        },
      );
    };
    const second = setTimeout(() => { if (attempts.length === 1) start(); }, afterMs);
    const deadline = setTimeout(() => end(false, new Error("timeout")), timeoutMs);
    start();
  });
}

export async function fetchComments(fetchFn: typeof fetch, articleId: number): Promise<Comments> {
  return hedged(async (signal) => {
    const res = await fetchFn(commentsUrl(articleId), { headers: HEADERS, signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parseComments(await res.text());
  });
}

/** A logged-in read without the viewer's own votes, so it may be kept as the shared fallback copy. */
export function withoutViewer(data: Comments): Comments {
  const strip = (c: Comment): Comment => ({
    ...c,
    vote: 0,
    ...(c.poll ? { poll: { ...c.poll, voted: false } } : {}),
    replies: c.replies.map(strip),
  });
  return { ...data, comments: data.comments.map(strip) };
}

const num = (s: string | undefined) => {
  const n = Number.parseInt(s ?? "", 10);
  return Number.isFinite(n) ? n : 0;
};
const clean = (s: string) => s.replace(/\s+/g, " ").trim();
/** Text of a comment body: markup dropped, <br> kept as line breaks. */
function bodyText($: CheerioAPI, p: ReturnType<CheerioAPI>) {
  p.find("br").replaceWith("\n");
  return p.text().split("\n").map(clean).filter(Boolean).join("\n");
}

function parseOne($: CheerioAPI, li: Element): Comment {
  const el = $(li);
  // A comment's own parts sit in its box; nested replies live in a sibling list.
  const box = el.children('[class$="__box"]').first();
  const scope = box.length ? box : el;
  const pollEl = scope.find(".poll-comment").first();
  const date = new Date(el.attr("data-comment-date") ?? "");
  const votingId = num(pollEl.find("[data-poll-options]").attr("data-voting-id"));
  return {
    id: num(el.attr("data-comment-id")),
    user: clean(scope.find('[class$="__username"]').first().text()),
    date: Number.isNaN(date.getTime()) ? "" : date.toISOString(),
    text: bodyText($, scope.find('p[class$="__text"]').first()),
    score: num(scope.find("[data-score-display]").first().text()),
    vote: num(el.attr("data-vote-state")),
    ...(pollEl.length
      ? {
          poll: {
            question: clean(pollEl.find(".poll-comment__question").text()),
            total: num(pollEl.find("[data-poll-options]").attr("data-total")),
            voted: pollEl.find("[data-poll-options]").attr("data-voted") === "1",
            ...(votingId ? { votingId } : {}),
            options: pollEl.find(".poll-option").toArray().map((o) => {
              const id = num($(o).attr("data-option-id"));
              return {
                label: clean($(o).find(".poll-option__label").text()),
                pct: num($(o).attr("data-pct")),
                ...(id ? { id } : {}),
              };
            }),
          },
        }
      : {}),
    replies: el
      .children(".comment-reply-tree-v2")
      .children("li[data-comment-id]")
      .toArray()
      .map((r) => parseOne($, r)),
  };
}

export function parseComments(html: string): Comments {
  const $ = load(html);
  const comments = $('li[data-comment-id][data-depth="0"]').toArray().map((li) => parseOne($, li));
  return { total: num($("[data-comment-count]").first().text()) || comments.length, comments };
}

/** The subset of Cloudflare's Cache API we use (caches.default). */
export type EdgeCache = {
  match(key: string): Promise<Response | undefined>;
  put(key: string, res: Response): Promise<void>;
};

/** A logged-in read is that viewer's vote state, so it must not enter the shared cache. */
export type CommentsOpts = { personal?: boolean };

/**
 * Serves load() as JSON, cached at the edge for COMMENTS_TTL_SECONDS. Every good answer is also kept for a
 * day (personal ones without the viewer's votes); when LigaInsider fails, that copy is served with
 * "x-stale: 1", and only without one the answer is a 502.
 */
async function cachedJson<T>(
  key: string,
  load: () => Promise<T>,
  cache: EdgeCache | undefined,
  { personal = false, shareable = (data: T): unknown => data } = {},
): Promise<Response> {
  const hit = personal ? undefined : await cache?.match(key);
  if (hit) return hit;
  const staleKey = `${key}?stale`;
  let data: T;
  try {
    data = await load();
  } catch {
    const stale = await cache?.match(staleKey);
    if (stale) {
      return new Response(stale.body, { headers: { "content-type": "application/json", "cache-control": "no-store", "x-stale": "1" } });
    }
    return Response.json({ error: "unavailable" }, { status: 502, headers: { "cache-control": "no-store" } });
  }
  const res = Response.json(data, {
    headers: { "cache-control": personal ? "private, no-store" : `public, max-age=${COMMENTS_TTL_SECONDS}` },
  });
  if (!personal) await cache?.put(key, res.clone());
  await cache?.put(staleKey, Response.json(shareable(data), { headers: { "cache-control": `public, max-age=${STALE_SECONDS}` } }));
  return res;
}

/** GET /api/comments/<id>/: LigaInsider's comments on one article. */
export async function commentsResponse(id: string, fetchFn: typeof fetch, cache?: EdgeCache, opts?: CommentsOpts): Promise<Response> {
  if (!/^\d{1,9}$/.test(id)) return new Response("Not found", { status: 404 });
  return cachedJson(`https://comments.cache/${id}`, () => fetchComments(fetchFn, Number(id)), cache, {
    personal: opts?.personal,
    shareable: withoutViewer,
  });
}

/** The overview whose comment counts the news page refreshes live (the newest ~15 articles). */
export const COUNTS_URL = "https://www.ligainsider.de/bundesliga-news/uebersicht/";

/** GET /api/comment-counts/: article id → comment count for LigaInsider's newest articles. */
export async function commentCountsResponse(fetchFn: typeof fetch, cache?: EdgeCache): Promise<Response> {
  return cachedJson("https://comments.cache/counts", () => hedged(async (signal) => {
    const res = await fetchFn(COUNTS_URL, { headers: HEADERS, signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parseCommentCounts(await res.text());
  }), cache);
}
