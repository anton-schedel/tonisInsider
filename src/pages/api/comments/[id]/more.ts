import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { currentLiga, withCookie } from "../../../../lib/ligaAccount.ts";
import { moreCommentsResponse } from "../../../../lib/comments.ts";
import { edgeCache, later } from "../../../../lib/http.ts";

export const prerender = false;

export const GET: APIRoute = async ({ params, cookies, url, locals }) => {
  const cache = edgeCache();
  const id = params.id ?? "";
  try {
    const session = await currentLiga(cookies, env.CREDENTIALS_KEY, fetch);
    if (session) return moreCommentsResponse(id, url.searchParams, withCookie(fetch, session.cookie), cache, { personal: true, later: later(locals) });
  } catch { /* fall through to the public batch */ }
  return moreCommentsResponse(id, url.searchParams, fetch, cache, { later: later(locals) });
};
