import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { LigaInsiderAuthError, login } from "../../lib/ligainsider.ts";
import { isSameOrigin, rememberLiga, safeNext, setLigaSession } from "../../lib/session.ts";

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const fail = (error: string, next: string) => {
    const res = redirect(`/login/?error=${error}&next=${encodeURIComponent(next)}`, 303);
    res.headers.set("Cache-Control", "private, no-store");
    return res;
  };
  if (!isSameOrigin(request)) return new Response("Forbidden", { status: 403, headers: { "Cache-Control": "private, no-store" } });
  const form = await request.formData();
  const username = String(form.get("username") ?? "").trim();
  const password = String(form.get("password") ?? "");
  const next = safeNext(String(form.get("next") ?? ""));
  if (!username || !password) return fail("li-credentials", next);
  try {
    const session = await login(fetch, username, password);
    setLigaSession(cookies, session.cookie, username);
    await rememberLiga(cookies, env.CREDENTIALS_KEY, username, password);
    const res = redirect(next, 303);
    res.headers.set("Cache-Control", "private, no-store");
    return res;
  } catch (err) {
    return fail(err instanceof LigaInsiderAuthError ? "li-credentials" : "li-unavailable", next);
  }
};
