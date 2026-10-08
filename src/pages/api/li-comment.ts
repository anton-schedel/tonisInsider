import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { callLiga } from "../../lib/ligaAccount.ts";
import { LigaInsiderAuthError, LigaInsiderRejectedError, parseAction, runAction } from "../../lib/ligainsider.ts";
import { isSameOrigin } from "../../lib/session.ts";

export const prerender = false;

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "private, no-store" } });

export const POST: APIRoute = async ({ request, cookies }) => {
  if (!isSameOrigin(request)) {
    console.warn(`li-comment: foreign origin ${request.headers.get("origin") ?? "none"}`);
    return new Response("Forbidden", { status: 403, headers: { "cache-control": "private, no-store" } });
  }
  let raw: unknown;
  try { raw = await request.json(); } catch { return json({ error: "Ungültige Anfrage." }, 400); }
  const articleId = articleIdOf(raw);
  const action = parseAction(raw);
  if (!articleId || !action) return json({ error: "Ungültige Anfrage." }, 400);
  try {
    const result = await callLiga(cookies, env.CREDENTIALS_KEY, fetch, (session) => runAction(fetch, session, articleId, action));
    return json({ ok: true, commentId: result.commentId });
  } catch (err) {
    // Only the kind of failure, never cookies or the comment text: shows up in the Worker logs.
    console.warn(`li-comment ${action.kind} failed: ${err instanceof Error ? `${err.constructor.name}: ${err.message}` : "unknown"}`);
    if (err instanceof LigaInsiderAuthError) return json({ error: "Melde dich mit LigaInsider an." }, 401);
    if (err instanceof LigaInsiderRejectedError) return json({ error: err.message }, 400);
    return json({ error: "LigaInsider ist gerade nicht erreichbar." }, 502);
  }
};

function articleIdOf(raw: unknown): number | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const n = Number((raw as { articleId?: unknown }).articleId);
  return Number.isInteger(n) && n > 0 && n < 1_000_000_000 ? n : undefined;
}
