import type { APIRoute } from "astro";
import { commentCountsResponse, type EdgeCache } from "../../lib/comments.ts";

export const prerender = false;

export const GET: APIRoute = async () => {
  // Cloudflare's edge cache; absent outside the Worker runtime.
  const cache = (globalThis as { caches?: { default?: EdgeCache } }).caches?.default;
  return commentCountsResponse(fetch, cache);
};
