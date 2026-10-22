import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { currentLiga, withCookie } from "../../../../lib/ligaAccount.ts";
import { moreCommentsResponse, type EdgeCache } from "../../../../lib/comments.ts";

export const prerender = false;

export const GET: APIRoute = async ({ params, cookies, url }) => {
  const cache = (globalThis as { caches?: { default?: EdgeCache } }).caches?.default;
  const id = params.id ?? "";
  try {
    const session = await currentLiga(cookies, env.CREDENTIALS_KEY, fetch);
    if (session) return moreCommentsResponse(id, url.searchParams, withCookie(fetch, session.cookie), cache, { personal: true });
  } catch { /* fall through to the public batch */ }
  return moreCommentsResponse(id, url.searchParams, fetch, cache);
};
