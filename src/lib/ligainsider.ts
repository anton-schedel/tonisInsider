import { commentsUrl } from "./comments.ts";

const ORIGIN = "https://www.ligainsider.de";
/**
 * LigaInsider's comment script is jQuery's $.post from a normal Chrome tab. A bare Worker
 * request (Safari UA, Accept: application/json, no X-Requested-With) is refused with 502,
 * while the same fields from the browser succeed. These headers are what that tab sends.
 */
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const BROWSER: Record<string, string> = {
  "user-agent": BROWSER_UA,
  "accept-language": "de-DE,de;q=0.9,en;q=0.8",
  "sec-ch-ua": '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"macOS"',
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-origin",
};
/** LigaInsider sometimes takes 10 s and more; a write that times out may still have gone through. */
const TIMEOUT_MS = 15000;

/** LigaInsider rejected the username or password, or the session is no longer logged in. */
export class LigaInsiderAuthError extends Error {}
/** LigaInsider refused this comment, reply, vote or poll. */
export class LigaInsiderRejectedError extends Error {}
/** LigaInsider is unreachable or answered unexpectedly. */
export class LigaInsiderUnavailableError extends Error {}

/** Cookie header captured from LigaInsider's login. */
export type LiSession = { cookie: string };

type Fetch = typeof fetch;

function mergeCookies(existing: string, setCookies: string[]): string {
  const jar = new Map<string, string>();
  const add = (pair: string) => {
    const eq = pair.indexOf("=");
    const name = pair.slice(0, eq).trim();
    if (eq > 0 && name) jar.set(name, pair.slice(eq + 1).trim());
  };
  for (const part of existing.split(";")) if (part.includes("=")) add(part.trim());
  for (const header of setCookies) add(header.split(";")[0] ?? "");
  return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
}

function setCookiesOf(res: Response): string[] {
  const headers = res.headers as Headers & { getSetCookie?: () => string[] };
  return typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [];
}

function isLoginRedirect(status: number, location: string | null): boolean {
  if (status < 300 || status > 399) return false;
  const path = (location ?? "").split("?")[0] ?? "";
  const pathname = path.startsWith("http") ? new URL(path).pathname : path;
  return pathname === "/login" || pathname.startsWith("/login/");
}

/** Only a LigaInsider page. Anything else falls back to the homepage, so Referer can't be used to leak the request elsewhere. */
export function pageReferer(value: string | undefined): string {
  if (!value) return `${ORIGIN}/`;
  try {
    const url = new URL(value);
    if (url.origin === ORIGIN && (url.protocol === "https:" || url.protocol === "http:")) return url.href;
  } catch { /* not a URL */ }
  return `${ORIGIN}/`;
}

async function request(fetchFn: Fetch, url: string, init: RequestInit & { cookie?: string } = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  for (const [name, value] of Object.entries(BROWSER)) headers.set(name, value);
  if (init.cookie) headers.set("cookie", init.cookie);
  try {
    return await fetchFn(url, { ...init, headers, signal: init.signal ?? AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    if (err instanceof LigaInsiderAuthError || err instanceof LigaInsiderRejectedError) throw err;
    throw new LigaInsiderUnavailableError("network error or timeout");
  }
}

/** Logs in the way the website does and returns the session cookies. */
export async function login(fetchFn: Fetch, username: string, password: string): Promise<LiSession> {
  const page = await request(fetchFn, `${ORIGIN}/login/`, { redirect: "manual" });
  let cookie = mergeCookies("", setCookiesOf(page));
  const res = await request(fetchFn, `${ORIGIN}/user/login/`, {
    method: "POST",
    redirect: "manual",
    cookie,
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      origin: ORIGIN,
      referer: `${ORIGIN}/login/`,
    },
    body: new URLSearchParams({ username, password, return: "/", belogin: "1" }),
  });
  cookie = mergeCookies(cookie, setCookiesOf(res));
  if (isLoginRedirect(res.status, res.headers.get("location"))) throw new LigaInsiderAuthError("login rejected");
  if (res.status < 300 || res.status > 399 || !cookie.includes("li_at=")) {
    throw new LigaInsiderUnavailableError(`HTTP ${res.status}`);
  }
  return { cookie };
}

/**
 * The form token comes from LigaInsider's comment page, whose answer times are random (0.2 s to 12 s measured).
 * One request only. A second copy in parallel takes LigaInsider's PHP session lock, so the first one
 * cannot finish and both are cut off — the like and the poll then come back as unreachable.
 */
const TOKEN_TIMEOUT_MS = 25_000;

async function csrfToken(fetchFn: Fetch, session: LiSession, articleId: number, referer: string): Promise<string> {
  const res = await request(fetchFn, commentsUrl(articleId), {
    cookie: session.cookie,
    headers: {
      accept: "text/html, */*; q=0.01",
      "x-requested-with": "XMLHttpRequest",
      referer,
    },
    signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
  });
  if (isLoginRedirect(res.status, res.headers.get("location"))) throw new LigaInsiderAuthError("session expired");
  if (!res.ok) throw new LigaInsiderUnavailableError(`token page HTTP ${res.status}`);
  const token = (await res.text()).match(/name="csrf_token" value="([^"]+)"/)?.[1];
  if (!token) throw new LigaInsiderAuthError("session expired");
  return token;
}

async function graph(fetchFn: Fetch, session: LiSession, articleId: number, fields: Record<string, string>, referer = `${ORIGIN}/`): Promise<{ commentId?: string }> {
  const page = pageReferer(referer);
  const token = await csrfToken(fetchFn, session, articleId, page);
  const send = () => request(fetchFn, `${ORIGIN}/comment/graph/`, {
    method: "POST",
    redirect: "manual",
    cookie: session.cookie,
    headers: {
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      accept: "*/*",
      "x-requested-with": "XMLHttpRequest",
      origin: ORIGIN,
      referer: page,
    },
    body: new URLSearchParams({ csrf_token: token, csrf_form: "comment_graph", ...fields }),
  });
  // LigaInsider's gateway sometimes answers the first write with a bare 502 ("error code: 502")
  // and accepts the same post immediately after. One retry; the token page is not fetched again.
  let res = await send();
  if (res.status === 502 || res.status === 503 || res.status === 504) {
    await res.body?.cancel();
    res = await send();
  }
  if (isLoginRedirect(res.status, res.headers.get("location"))) throw new LigaInsiderAuthError("session expired");
  if (!res.ok) {
    const snippet = (await res.text()).replace(/\s+/g, " ").slice(0, 160);
    throw new LigaInsiderUnavailableError(`post HTTP ${res.status}${snippet ? ` ${snippet}` : ""}`);
  }
  let data: { success?: boolean; message?: string; commentID?: string };
  try {
    data = await res.json();
  } catch {
    throw new LigaInsiderUnavailableError("invalid JSON");
  }
  if (!data.success) throw new LigaInsiderRejectedError(data.message || "LigaInsider hat das abgelehnt");
  return { commentId: data.commentID };
}

export function createComment(fetchFn: Fetch, session: LiSession, articleId: number, body: string, referer?: string) {
  return graph(fetchFn, session, articleId, { action: "create", newsID: String(articleId), body }, referer);
}

export function reply(fetchFn: Fetch, session: LiSession, articleId: number, commentId: number, body: string, referer?: string) {
  return graph(fetchFn, session, articleId, { action: "create", commentID: String(commentId), body }, referer);
}

export function upvote(fetchFn: Fetch, session: LiSession, articleId: number, commentId: number, currentVote: number, referer?: string) {
  return graph(fetchFn, session, articleId, {
    action: "vote",
    commentID: String(commentId),
    direction: "up",
    currentVote: String(currentVote),
  }, referer);
}

export function votePoll(fetchFn: Fetch, session: LiSession, articleId: number, votingId: number, optionId: number, referer?: string) {
  return graph(fetchFn, session, articleId, { action: "poll_vote", votingID: String(votingId), optionID: String(optionId) }, referer);
}

export type LiAction =
  | { kind: "comment"; body: string }
  | { kind: "reply"; commentId: number; body: string }
  | { kind: "vote"; commentId: number; currentVote: number }
  | { kind: "pollvote"; votingId: number; optionId: number }
  | { kind: "poll"; question: string; options: string[] };

const text = (value: unknown, min: number, max: number) => {
  const s = typeof value === "string" ? value.trim() : "";
  return s.length >= min && s.length <= max ? s : undefined;
};
const id = (value: unknown) => {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isInteger(n) && n > 0 && n < 1_000_000_000 ? n : undefined;
};

/** The comment-box payload. Undefined when a field is missing or out of range. */
export function parseAction(raw: unknown): LiAction | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const body = raw as Record<string, unknown>;
  if (body.kind === "comment") {
    const t = text(body.body, 2, 2000);
    return t ? { kind: "comment", body: t } : undefined;
  }
  if (body.kind === "reply") {
    const commentId = id(body.commentId);
    const t = text(body.body, 2, 2000);
    return commentId && t ? { kind: "reply", commentId, body: t } : undefined;
  }
  if (body.kind === "vote") {
    const commentId = id(body.commentId);
    const currentVote = Number(body.currentVote);
    return commentId && [-1, 0, 1].includes(currentVote) ? { kind: "vote", commentId, currentVote } : undefined;
  }
  if (body.kind === "pollvote") {
    const votingId = id(body.votingId);
    const optionId = id(body.optionId);
    return votingId && optionId ? { kind: "pollvote", votingId, optionId } : undefined;
  }
  if (body.kind === "poll") {
    const question = text(body.question, 2, 200);
    const options = Array.isArray(body.options) ? body.options.map((o) => text(o, 1, 80)).filter((o): o is string => !!o) : [];
    return question && options.length >= 2 && options.length <= 6 && options.length === (body.options as unknown[]).length
      ? { kind: "poll", question, options }
      : undefined;
  }
  return undefined;
}

export function runAction(fetchFn: Fetch, session: LiSession, articleId: number, action: LiAction, referer?: string) {
  switch (action.kind) {
    case "comment": return createComment(fetchFn, session, articleId, action.body, referer);
    case "reply": return reply(fetchFn, session, articleId, action.commentId, action.body, referer);
    case "vote": return upvote(fetchFn, session, articleId, action.commentId, action.currentVote, referer);
    case "pollvote": return votePoll(fetchFn, session, articleId, action.votingId, action.optionId, referer);
    case "poll": return createPoll(fetchFn, session, articleId, action.question, action.options, referer);
  }
}

/** A single-choice poll. Labels are sent as plain text, which LigaInsider accepts. */
export function createPoll(fetchFn: Fetch, session: LiSession, articleId: number, question: string, options: string[], referer?: string) {
  return graph(fetchFn, session, articleId, {
    action: "create",
    newsID: String(articleId),
    body: question,
    poll: JSON.stringify({
      question,
      multiSelect: false,
      options: options.map((value) => ({ elements: [{ type: "Plaintext", value }] })),
    }),
  }, referer);
}
