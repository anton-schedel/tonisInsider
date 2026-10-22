import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { isSameOrigin } from "../../../lib/session.ts";
import { coachSignedIn, json, NOT_SIGNED_IN } from "../../../lib/coachApi.ts";

export const prerender = false;

const IMAGE_MAX = 600 * 1024;

/** POST /api/coach/images/?w=&h= (JPEG body, shrunk in the browser): stores a photo, returns its id. */
export const POST: APIRoute = async ({ request, cookies, url }) => {
  if (!isSameOrigin(request)) return json({ error: "Nicht erlaubt." }, 403);
  const db = env.COMMENTS;
  if (!db) return json({ error: "Gerade nicht erreichbar." }, 503);
  if (!(await coachSignedIn(cookies))) return json(NOT_SIGNED_IN, 401);
  if (request.headers.get("content-type") !== "image/jpeg") return json({ error: "Nur Fotos (JPEG)." }, 415);
  const body = new Uint8Array(await request.arrayBuffer());
  if (body.length > IMAGE_MAX) return json({ error: "Bild zu groß." }, 413);
  // JPEG starts with FF D8.
  if (body[0] !== 0xff || body[1] !== 0xd8) return json({ error: "Nur Fotos (JPEG)." }, 415);
  const width = Number(url.searchParams.get("w"));
  const height = Number(url.searchParams.get("h"));
  if (!(width > 0 && width <= 4000 && height > 0 && height <= 4000)) return json({ error: "Ungültige Anfrage." }, 400);
  const id = [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, "0")).join("");
  await db.prepare("INSERT INTO coach_images (id, width, height, body, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(id, Math.round(width), Math.round(height), body, new Date().toISOString()).run();
  return json({ id, width, height });
};
