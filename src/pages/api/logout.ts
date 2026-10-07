import type { APIRoute } from "astro";
import { clearSession, isSameOrigin } from "../../lib/session.ts";

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  if (!isSameOrigin(request)) return new Response("Forbidden", { status: 403, headers: { "Cache-Control": "private, no-store" } });
  clearSession(cookies);
  const res = redirect("/", 303);
  res.headers.set("Cache-Control", "private, no-store");
  return res;
};
