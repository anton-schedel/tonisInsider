import { env, type D1 } from "cloudflare:workers";
import { isSameOrigin, type CookieJar } from "./session.ts";
import { isOwnPost, VOTER_COOKIE } from "./ownComments.ts";
import { json, notAllowed } from "./http.ts";

/** The visitor's vote id from the cookie; with `create`, a new one is made and set (400 days). */
export function voterOf(cookies: CookieJar, create = false): string {
  const v = cookies.get(VOTER_COOKIE)?.value;
  if (v && /^[0-9a-f]{32}$/.test(v)) return v;
  if (!create) return "";
  const id = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
  cookies.set(VOTER_COOKIE, id, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 400 * 86_400 });
  return id;
}

/** The database and post for a request on one of our own posts, or what to answer when it may not go on. */
export function ownGuard(request: Request, id: string | undefined): { db: D1; postId: number } | Response {
  if (request.method !== "GET" && request.method !== "HEAD" && !isSameOrigin(request)) return notAllowed();
  const postId = Number(id);
  const db = env.COMMENTS;
  if (!isOwnPost(postId) || !db) return json({ error: "Nicht gefunden." }, 404);
  return { db, postId };
}
