import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { callLiga } from "../../lib/ligaAccount.ts";
import { LigaInsiderAuthError, LigaInsiderRejectedError, pageReferer, parseAction, runAction } from "../../lib/ligainsider.ts";
import { isSameOrigin } from "../../lib/session.ts";
import { parseThreadKey, type Thread } from "../../lib/comments.ts";
import { forbidden, json, readJson } from "../../lib/http.ts";

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies }) => {
  if (!isSameOrigin(request)) {
    console.warn(`li-comment: foreign origin ${request.headers.get("origin") ?? "none"}`);
    return forbidden();
  }
  const raw = await readJson(request);
  if (raw instanceof Response) return raw;
  const thread = threadOf(raw);
  const action = parseAction(raw);
  if (thread === undefined || !action) return json({ error: "Ungültige Anfrage." }, 400);
  try {
    const referer = pageReferer(typeof (raw as { page?: unknown }).page === "string" ? (raw as { page: string }).page : undefined);
    const result = await callLiga(cookies, env.CREDENTIALS_KEY, fetch, (session) => runAction(fetch, session, thread, action, referer));
    return json({ ok: true, commentId: result.commentId });
  } catch (err) {
    // Only the kind of failure, never cookies or the comment text: shows up in the Worker logs.
    console.warn(`li-comment ${action.kind} failed: ${err instanceof Error ? `${err.constructor.name}: ${err.message}` : "unknown"}`);
    if (err instanceof LigaInsiderAuthError) return json({ error: "Melde dich mit LigaInsider an." }, 401);
    if (err instanceof LigaInsiderRejectedError) return json({ error: err.message }, 400);
    return json({ error: "LigaInsider ist gerade nicht erreichbar." }, 502);
  }
};

/** The thread key ("418776", or "t…" for a lineup page); older pages send articleId. */
function threadOf(raw: unknown): Thread | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const { thread, articleId } = raw as { thread?: unknown; articleId?: unknown };
  if (typeof thread === "string") return parseThreadKey(thread);
  const n = Number(articleId);
  return Number.isInteger(n) && n > 0 && n < 1_000_000_000 ? n : undefined;
}
