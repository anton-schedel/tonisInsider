import type { APIRoute } from "astro";
import { commentsResponse, type EdgeCache } from "../../../lib/comments.ts";

export const prerender = false;

export const GET: APIRoute = async ({ params }) => {
  // Cloudflare's edge cache; absent outside the Worker runtime.
  const cache = (globalThis as { caches?: { default?: EdgeCache } }).caches?.default;
  return commentsResponse(params.id ?? "", fetch, cache);
};
