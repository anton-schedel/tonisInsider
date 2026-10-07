import { load, type CheerioAPI } from "cheerio/slim";
import type { Element } from "domhandler";
import { USER_AGENT } from "../../scraper/fetch.ts";
import { parseCommentCounts } from "../../scraper/parse/commentCounts.ts";

/** LigaInsider comments are fetched live per article view and cached this long at the edge. */
export const COMMENTS_TTL_SECONDS = 120;
const TIMEOUT_MS = 8000;
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

export async function fetchComments(fetchFn: typeof fetch, articleId: number): Promise<Comments> {
  const res = await fetchFn(commentsUrl(articleId), {
    headers: HEADERS,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseComments(await res.text());
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

/** Serves load() as JSON, cached at the edge for COMMENTS_TTL_SECONDS; failures answer 502 and aren't cached. */
async function cachedJson(key: string, load: () => Promise<unknown>, cache?: EdgeCache, personal = false): Promise<Response> {
  const hit = personal ? undefined : await cache?.match(key);
  if (hit) return hit;
  let data: unknown;
  try {
    data = await load();
  } catch {
    return Response.json({ error: "unavailable" }, { status: 502, headers: { "cache-control": "no-store" } });
  }
  const res = Response.json(data, {
    headers: { "cache-control": personal ? "private, no-store" : `public, max-age=${COMMENTS_TTL_SECONDS}` },
  });
  if (!personal) await cache?.put(key, res.clone());
  return res;
}

/** GET /api/comments/<id>/: LigaInsider's comments on one article. */
export async function commentsResponse(id: string, fetchFn: typeof fetch, cache?: EdgeCache, opts?: CommentsOpts): Promise<Response> {
  if (!/^\d{1,9}$/.test(id)) return new Response("Not found", { status: 404 });
  return cachedJson(`https://comments.cache/${id}`, () => fetchComments(fetchFn, Number(id)), cache, opts?.personal);
}

/** The overview whose comment counts the news page refreshes live (the newest ~15 articles). */
export const COUNTS_URL = "https://www.ligainsider.de/bundesliga-news/uebersicht/";

/** GET /api/comment-counts/: article id → comment count for LigaInsider's newest articles. */
export async function commentCountsResponse(fetchFn: typeof fetch, cache?: EdgeCache): Promise<Response> {
  return cachedJson("https://comments.cache/counts", async () => {
    const res = await fetchFn(COUNTS_URL, { headers: HEADERS, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parseCommentCounts(await res.text());
  }, cache);
}
