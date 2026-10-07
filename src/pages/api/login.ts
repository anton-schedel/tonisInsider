import type { APIRoute } from "astro";
import { KickbaseAuthError, login } from "../../lib/kickbase.ts";
import { isSameOrigin, setSession } from "../../lib/session.ts";

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  if (!isSameOrigin(request)) return new Response("Forbidden", { status: 403 });
  const form = await request.formData();
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  if (!email || !password) return redirect("/login/?error=credentials", 303);
  try {
    const session = await login(fetch, email, password);
    setSession(cookies, session.token, new Date(session.expires));
    return redirect("/mein-team/", 303);
  } catch (err) {
    // Never log the request body or Kickbase's response: they contain credentials/tokens.
    return redirect(`/login/?error=${err instanceof KickbaseAuthError ? "credentials" : "unavailable"}`, 303);
  }
};
