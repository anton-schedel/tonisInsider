import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { currentLiga, withCookie } from "../../../lib/ligaAccount.ts";
import { commentsResponse, type EdgeCache } from "../../../lib/comments.ts";

export const prerender = false;

export const GET: APIRoute = async ({ params, cookies }) => {
  // Personal reads skip the shared copy but still keep/serve the fallback (stored without the viewer's votes).
  const cache = (globalThis as { caches?: { default?: EdgeCache } }).caches?.default;
  const id = params.id ?? "";
  // A LigaInsider hiccup must not hide the public thread.
  try {
    const session = await currentLiga(cookies, env.CREDENTIALS_KEY, fetch);
    if (session) return commentsResponse(id, withCookie(fetch, session.cookie), cache, { personal: true });
  } catch { /* fall through to the public thread */ }
  return commentsResponse(id, fetch, cache);
};
