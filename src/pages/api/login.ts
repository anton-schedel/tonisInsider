import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { KickbaseAuthError, login } from "../../lib/kickbase.ts";
import { getPostHogServer } from "../../lib/posthog-server.ts";
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
  const browserDistinctId = String(form.get("posthog_distinct_id") ?? request.headers.get("X-PostHog-Distinct-Id") ?? "").trim();
  const browserSessionId = String(form.get("posthog_session_id") ?? request.headers.get("X-PostHog-Session-Id") ?? "").trim();
  if (!email || !password) return redirect("/einstellungen/?error=credentials", 303);
  try {
    const session = await login(fetch, email, password);
    setSession(cookies, session.token, parseExpiry(session.expires), session.name, session.userId);
    await rememberCredentials(cookies, env.CREDENTIALS_KEY, email, password);

    const posthog = getPostHogServer();
    const distinctId = session.userId || browserDistinctId;
    if (posthog && distinctId) {
      posthog.capture({
        distinctId,
        event: "kickbase_login_succeeded",
        properties: {
          $session_id: browserSessionId || undefined,
        },
      });
      await posthog.flush();
    }

    return redirect("/mein-team/", 303);
  } catch (err) {
    // Never log the request body or Kickbase's response: they contain credentials/tokens.
    return redirect(`/einstellungen/?error=${err instanceof KickbaseAuthError ? "credentials" : "unavailable"}`, 303);
  }
};
