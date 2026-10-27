import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { isSameOrigin } from "../../../lib/session.ts";
import { senderKey } from "../../../lib/ownComments.ts";
import { COACH_COOKIE, COACH_DAYS, LOGIN_RATE, passwordMatches, signCoach } from "../../../lib/coachAuth.ts";
import { json, readJson } from "../../../lib/http.ts";

export const prerender = false;

/** POST /api/coach/login/ {password}: the coach's cookie for 90 days. Five wrong tries per sender in 10 minutes. */
export const POST: APIRoute = async ({ request, cookies }) => {
  if (!isSameOrigin(request)) return json({ error: "Nicht erlaubt." }, 403);
  const db = env.COMMENTS;
  if (!db || !env.CREDENTIALS_KEY || !env.COACH_PASSWORD) return json({ error: "Die Trainerseite ist noch nicht eingerichtet." }, 503);
  const raw = await readJson<{ password?: unknown }>(request);
  if (raw instanceof Response) return raw;
  const password = String(raw.password ?? "");

  const sender = await senderKey(request.headers.get("cf-connecting-ip") ?? "", env.CREDENTIALS_KEY);
  const since = new Date(Date.now() - LOGIN_RATE.windowMs).toISOString();
  await db.prepare("DELETE FROM coach_login WHERE at < ?").bind(since).run();
  const tries = await db.prepare("SELECT COUNT(*) AS n FROM coach_login WHERE sender = ?").bind(sender).first<{ n: number }>();
  if ((tries?.n ?? 0) >= LOGIN_RATE.count) return json({ error: "Zu viele Versuche. Probier es in ein paar Minuten nochmal." }, 429);

  if (!passwordMatches(password, env.COACH_PASSWORD)) {
    await db.prepare("INSERT INTO coach_login (sender, at) VALUES (?, ?)").bind(sender, new Date().toISOString()).run();
    return json({ error: "Falsches Passwort." }, 401);
  }
  cookies.set(COACH_COOKIE, await signCoach(env.CREDENTIALS_KEY, Date.now()), {
    httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: COACH_DAYS * 86_400,
  });
  return json({ ok: true });
};

/** DELETE /api/coach/login/: sign out. */
export const DELETE: APIRoute = async ({ request, cookies }) => {
  if (!isSameOrigin(request)) return json({ error: "Nicht erlaubt." }, 403);
  cookies.delete(COACH_COOKIE, { path: "/" });
  return json({ ok: true });
};
