import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { KickbaseAuthError, login } from "../../lib/kickbase.ts";
import { isSameOrigin, parseExpiry, rememberCredentials, setSession } from "../../lib/session.ts";

export const prerender = false;

export const POST: APIRoute = async (context) => {
  const res = await handle(context);
  res.headers.set("Cache-Control", "private, no-store");
  return res;
};

const handle: APIRoute = async ({ request, cookies, redirect }) => {
  if (!isSameOrigin(request)) return new Response("Forbidden", { status: 403 });
  const form = await request.formData();
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  if (!email || !password) return redirect("/einstellungen/?error=credentials", 303);
  try {
    const session = await login(fetch, email, password);
    setSession(cookies, session.token, parseExpiry(session.expires));
    await rememberCredentials(cookies, env.CREDENTIALS_KEY, email, password);
    return redirect("/mein-team/", 303);
  } catch (err) {
    // Never log the request body or Kickbase's response: they contain credentials/tokens.
    return redirect(`/einstellungen/?error=${err instanceof KickbaseAuthError ? "credentials" : "unavailable"}`, 303);
  }
};
