export const KICKBASE_API = "https://api.kickbase.com";
const TIMEOUT_MS = 8000;

/** Kickbase rejected the credentials or the token (HTTP 401/403). */
export class KickbaseAuthError extends Error {}
/** Kickbase is unreachable or answered unexpectedly. */
export class KickbaseUnavailableError extends Error {}

export type KbLogin = { token: string; expires: string; userId: string };
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
  if (res.status === 401 || res.status === 403) throw new KickbaseAuthError(`HTTP ${res.status}`);
  if (!res.ok) throw new KickbaseUnavailableError(`HTTP ${res.status}`);
  try {
    return (await res.json()) as T;
  } catch {
    throw new KickbaseUnavailableError("invalid JSON");
  }
}

export async function login(fetchFn: Fetch, email: string, password: string): Promise<KbLogin> {
  const r = await call<{ tkn?: string; tknex?: string; u?: { id?: string } }>(fetchFn, "/v4/user/login", {
    method: "POST",
    body: { em: email, pass: password, loy: false, rep: {} },
  });
  if (!r.tkn) throw new KickbaseUnavailableError("login response without token");
  return { token: r.tkn, expires: r.tknex ?? new Date(Date.now() + 86_400_000).toISOString(), userId: r.u?.id ?? "" };
}

export async function leagues(fetchFn: Fetch, token: string): Promise<KbLeague[]> {
  const r = await call<{ it?: { i: string; n: string }[] }>(fetchFn, "/v4/leagues/selection", { token });
  return (r.it ?? []).map((l) => ({ id: String(l.i), name: l.n }));
}

export async function squad(fetchFn: Fetch, token: string, leagueId: string): Promise<KbPlayer[]> {
  const r = await call<{ it?: { i: string; n: string; tid: string; pos: number; pim?: string }[] }>(
    fetchFn, `/v4/leagues/${encodeURIComponent(leagueId)}/squad`, { token },
  );
  return (r.it ?? []).map((p) => ({
    id: String(p.i),
    name: p.n,
    teamId: String(p.tid),
    position: ([1, 2, 3, 4].includes(p.pos) ? p.pos : 3) as KbPlayer["position"],
    image: p.pim ? `https://kickbase.b-cdn.net/${p.pim}` : undefined,
  }));
}

export async function clubTable(fetchFn: Fetch, token: string): Promise<KbTeam[]> {
  const r = await call<{ it?: { tid: string; tn: string }[] }>(fetchFn, "/v4/competitions/1/table", { token });
  return (r.it ?? []).map((t) => ({ id: String(t.tid), name: t.tn }));
}
