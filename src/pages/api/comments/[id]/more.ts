import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { currentLiga } from "../../../../lib/ligaAccount.ts";
import { moreCommentsResponse, type EdgeCache } from "../../../../lib/comments.ts";

export const prerender = false;

/** Sends the viewer's LigaInsider session so vote state is theirs (like the first page). */
function withCookie(base: typeof fetch, cookie: string): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    headers.set("cookie", cookie);
    return base(input, { ...init, headers });
  }) as typeof fetch;
}

export const GET: APIRoute = async ({ params, cookies, url }) => {
  const cache = (globalThis as { caches?: { default?: EdgeCache } }).caches?.default;
  const id = params.id ?? "";
  try {
    const session = await currentLiga(cookies, env.CREDENTIALS_KEY, fetch);
    if (session) return moreCommentsResponse(id, url.searchParams, withCookie(fetch, session.cookie), cache, { personal: true });
  } catch { /* fall through to the public batch */ }
  return moreCommentsResponse(id, url.searchParams, fetch, cache);
};
