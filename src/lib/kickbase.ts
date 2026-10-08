export const KICKBASE_API = "https://api.kickbase.com";
const TIMEOUT_MS = 8000;

/** Kickbase rejected the credentials or the token (HTTP 401). */
export class KickbaseAuthError extends Error {}
/** Kickbase is unreachable or answered unexpectedly. */
export class KickbaseUnavailableError extends Error {}

export type KbLogin = { token: string; expires: string; userId: string; name: string };
export type KbLeague = { id: string; name: string };
/** pos: 1 = TW, 2 = ABW, 3 = MF, 4 = ST */
export type KbPlayer = { id: string; name: string; teamId: string; position: 1 | 2 | 3 | 4; image?: string };
export type KbTeam = { id: string; name: string };

type Fetch = typeof fetch;

async function call<T>(fetchFn: Fetch, path: string, init: { method?: string; token?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetchFn(`${KICKBASE_API}${path}`, {
      method: init.method ?? "GET",
      headers: {
        accept: "application/json",
        ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
        ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new KickbaseUnavailableError("network error or timeout");
  }
  // Only 401 means "credentials/token invalid"; a 403 can also be a WAF or rate limit and must not log users out.
  if (res.status === 401) throw new KickbaseAuthError(`HTTP ${res.status}`);
  if (!res.ok) throw new KickbaseUnavailableError(`HTTP ${res.status}`);
  try {
    return (await res.json()) as T;
  } catch {
    throw new KickbaseUnavailableError("invalid JSON");
  }
}

export async function login(fetchFn: Fetch, email: string, password: string): Promise<KbLogin> {
  const r = await call<{ tkn?: string; tknex?: string; u?: { id?: string; name?: string } }>(fetchFn, "/v4/user/login", {
    method: "POST",
    body: { em: email, pass: password, loy: false, rep: {} },
  });
  if (!r.tkn) throw new KickbaseUnavailableError("login response without token");
  return { token: r.tkn, expires: r.tknex ?? new Date(Date.now() + 86_400_000).toISOString(), userId: r.u?.id ?? "", name: r.u?.name ?? "" };
}

export async function leagues(fetchFn: Fetch, token: string): Promise<KbLeague[]> {
  const r = await call<{ it?: { i: string; n: string }[] }>(fetchFn, "/v4/leagues/selection", { token });
  return (r.it ?? []).map((l) => ({ id: String(l.i), name: l.n }));
}

type ApiPlayer = { i: string; n: string; tid: string; pos: number; pim?: string };

function toPlayer(p: ApiPlayer): KbPlayer {
  return {
    id: String(p.i),
    name: p.n,
    teamId: String(p.tid),
    position: ([1, 2, 3, 4].includes(p.pos) ? p.pos : 3) as KbPlayer["position"],
    image: p.pim ? `https://kickbase.b-cdn.net/${p.pim}` : undefined,
  };
}

export async function squad(fetchFn: Fetch, token: string, leagueId: string): Promise<KbPlayer[]> {
  const r = await call<{ it?: ApiPlayer[] }>(fetchFn, `/v4/leagues/${encodeURIComponent(leagueId)}/squad`, { token });
  return (r.it ?? []).map(toPlayer);
}

/** The manager's Kickbase lineup: starting XI (lp) and the rest of the squad (nlp). */
export async function myEleven(fetchFn: Fetch, token: string, leagueId: string): Promise<{ starters: KbPlayer[]; bench: KbPlayer[] }> {
  const r = await call<{ lp?: ApiPlayer[]; nlp?: ApiPlayer[] }>(
    fetchFn, `/v4/leagues/${encodeURIComponent(leagueId)}/teamcenter/myeleven`, { token },
  );
  return { starters: (r.lp ?? []).map(toPlayer), bench: (r.nlp ?? []).map(toPlayer) };
}

/** All player names of a Bundesliga club (Kickbase display names), used to detect same-surname teammates. */
export async function teamRoster(fetchFn: Fetch, token: string, teamId: string): Promise<string[]> {
  const r = await call<{ it?: { n: string }[] }>(fetchFn, `/v4/competitions/1/teams/${encodeURIComponent(teamId)}/teamprofile`, { token });
  return (r.it ?? []).map((p) => p.n);
}

export async function clubTable(fetchFn: Fetch, token: string): Promise<KbTeam[]> {
  const r = await call<{ it?: { tid: string; tn: string }[] }>(fetchFn, "/v4/competitions/1/table", { token });
  return (r.it ?? []).map((t) => ({ id: String(t.tid), name: t.tn }));
}
