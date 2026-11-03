// The iOS app's session: it has no cookie jar, so it carries the site's cookies in one bearer token instead
// (sealed with CREDENTIALS_KEY like the "stay logged in" cookie). The Worker turns the token into the cookies the
// endpoints already read, and their Set-Cookie back into a new token — the endpoints themselves don't change.
import { seal, unseal } from "./vault.ts";

/** Marks a request from the app. A cross-site page can't send it without a CORS preflight, which we never answer. */
export const APP_HEADER = "x-toninsider-app";
/** A new token, whenever the response changed the session. */
export const TOKEN_HEADER = "x-app-token";

type Jar = Record<string, string>;

/** Only the API and the data files: pages stay browser-only. */
export function isAppRequest(request: Request): boolean {
  if (request.headers.get(APP_HEADER) !== "1") return false;
  const path = new URL(request.url).pathname;
  return path.startsWith("/api/") || path.startsWith("/data/");
}

/** The app's request as a browser on the site would send it: its cookies, our own origin, no token. */
export async function toCookieRequest(request: Request, key: string): Promise<{ request: Request; jar: Jar }> {
  const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  const jar = token ? await jarOf(token, key) : {};
  const headers = new Headers(request.headers);
  headers.delete("authorization");
  headers.delete("cookie");
  const cookie = Object.entries(jar).map(([name, value]) => `${name}=${value}`).join("; ");
  if (cookie) headers.set("cookie", cookie);
  headers.set("origin", new URL(request.url).origin);
  return { request: new Request(request, { headers }), jar };
}

/** A garbled token, or one sealed with an old key, is an empty session (signed out), never an error. */
async function jarOf(token: string, key: string): Promise<Jar> {
  const plain = await unseal(token, key);
  try {
    const parsed: unknown = plain ? JSON.parse(plain) : undefined;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter((e): e is [string, string] => typeof e[1] === "string"));
  } catch {
    return {};
  }
}

/** The response without Set-Cookie; what it set or deleted goes into a new token. */
export async function fromCookieResponse(response: Response, jar: Jar, key: string): Promise<Response> {
  const cookies = response.headers.getSetCookie();
  const headers = new Headers(response.headers);
  headers.delete("set-cookie");
  if (cookies.length) {
    const next = { ...jar };
    for (const line of cookies) {
      const [pair, ...attrs] = line.split(";");
      const eq = pair!.indexOf("=");
      if (eq < 1) continue;
      const name = pair!.slice(0, eq).trim();
      if (deleted(attrs)) delete next[name];
      else next[name] = pair!.slice(eq + 1).trim();
    }
    headers.set(TOKEN_HEADER, await seal(JSON.stringify(next), key));
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function deleted(attrs: string[]): boolean {
  return attrs.some((a) => {
    const [k, v = ""] = a.split("=").map((s) => s.trim());
    if (k!.toLowerCase() === "max-age") return Number(v) <= 0;
    if (k!.toLowerCase() === "expires") return Date.parse(v) <= Date.now();
    return false;
  });
}
