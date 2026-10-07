import { load, type CheerioAPI } from "cheerio/slim";
import type { Element } from "domhandler";
import { USER_AGENT } from "../../scraper/fetch.ts";

/** LigaInsider comments are fetched live per article view and cached this long at the edge. */
export const COMMENTS_TTL_SECONDS = 120;
const TIMEOUT_MS = 8000;

export type Poll = { question: string; total: number; options: { label: string; pct: number }[] };
export type Comment = {
  id: number;
  user: string;
  /** ISO */
  date: string;
  /** Plain text, never HTML. */
  text: string;
  score: number;
  poll?: Poll;
  replies: Comment[];
};
/** total counts all comments incl. replies; comments holds only LigaInsider's first page. */
export type Comments = { total: number; comments: Comment[] };

export const commentsUrl = (articleId: number) =>
  `https://www.ligainsider.de/apiesi/desktop/newscomments/?newsid=${articleId}`;

export async function fetchComments(fetchFn: typeof fetch, articleId: number): Promise<Comments> {
  const res = await fetchFn(commentsUrl(articleId), {
    headers: { "user-agent": USER_AGENT, "accept-language": "de-DE,de;q=0.9" },
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
  return {
    id: num(el.attr("data-comment-id")),
    user: clean(scope.find('[class$="__username"]').first().text()),
    date: Number.isNaN(date.getTime()) ? "" : date.toISOString(),
    text: bodyText($, scope.find('p[class$="__text"]').first()),
    score: num(scope.find("[data-score-display]").first().text()),
    ...(pollEl.length
      ? {
          poll: {
            question: clean(pollEl.find(".poll-comment__question").text()),
            total: num(pollEl.find("[data-poll-options]").attr("data-total")),
            options: pollEl.find(".poll-option").toArray().map((o) => ({
              label: clean($(o).find(".poll-option__label").text()),
              pct: num($(o).attr("data-pct")),
            })),
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

/** GET /api/comments/<id>/: LigaInsider's comments as JSON, cached at the edge for COMMENTS_TTL_SECONDS. */
export async function commentsResponse(id: string, fetchFn: typeof fetch, cache?: EdgeCache): Promise<Response> {
  if (!/^\d{1,9}$/.test(id)) return new Response("Not found", { status: 404 });
  const key = `https://comments.cache/${id}`;
  const hit = await cache?.match(key);
  if (hit) return hit;
  let data: Comments;
  try {
    data = await fetchComments(fetchFn, Number(id));
  } catch {
    return Response.json({ error: "unavailable" }, { status: 502, headers: { "cache-control": "no-store" } });
  }
  const res = Response.json(data, { headers: { "cache-control": `public, max-age=${COMMENTS_TTL_SECONDS}` } });
  await cache?.put(key, res.clone());
  return res;
}
