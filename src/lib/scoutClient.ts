/**
 * The scout list in the browser: saved with the Kickbase or LigaInsider account (/api/scout/), else in this
 * browser only. A list started without a login moves into the account at the next login.
 */
export type ScoutState = { ids: number[]; seenAt?: string; account: boolean };

const LOCAL = "scoutList";
const LOCAL_SEEN = "scoutSeen";
/** This tab's copy, so moving between pages doesn't ask the server each time. */
const SESSION = "scoutState";
const SESSION_MS = 60_000;

const read = <T>(store: Storage, key: string): T | undefined => {
  try { const v = store.getItem(key); return v ? (JSON.parse(v) as T) : undefined; } catch { return undefined; }
};
const write = (store: Storage, key: string, value: unknown) => {
  try { value === undefined ? store.removeItem(key) : store.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
};

const local = (): ScoutState => ({ ids: read<number[]>(localStorage, LOCAL) ?? [], seenAt: read<string>(localStorage, LOCAL_SEEN), account: false });
const remember = (s: ScoutState) => {
  write(sessionStorage, SESSION, { at: Date.now(), state: s });
  window.dispatchEvent(new CustomEvent("scout:change", { detail: s }));
  return s;
};

async function call(body?: object): Promise<ScoutState | undefined> {
  try {
    const res = await fetch("/api/scout/", body
      ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
      : undefined);
    if (res.status === 401) return undefined;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { ids: number[]; seenAt?: string };
    return { ids: data.ids, seenAt: data.seenAt, account: true };
  } catch {
    return undefined;
  }
}

const loggedIn = () => /(?:^|; )(?:kbin|liin)=1/.test(document.cookie);

export async function loadScout(fresh = false): Promise<ScoutState> {
  const cached = read<{ at: number; state: ScoutState }>(sessionStorage, SESSION);
  if (!fresh && cached && Date.now() - cached.at < SESSION_MS && cached.state.account === loggedIn()) return cached.state;
  if (!loggedIn()) return remember(local());
  const server = await call();
  if (!server) return remember(local());
  // Players picked before logging in join the account's list.
  const before = local().ids.filter((id) => !server.ids.includes(id));
  if (before.length) {
    const merged = await call({ add: before });
    if (merged) {
      write(localStorage, LOCAL, undefined);
      return remember(merged);
    }
  }
  return remember(server);
}

export async function setScouted(id: number, on: boolean): Promise<ScoutState> {
  const now = await loadScout();
  if (now.account) {
    const next = await call(on ? { add: [id] } : { remove: [id] });
    if (next) return remember(next);
    throw new Error("Konnte nicht gespeichert werden.");
  }
  const ids = on ? [id, ...now.ids.filter((x) => x !== id)] : now.ids.filter((x) => x !== id);
  write(localStorage, LOCAL, ids);
  if (on && !now.seenAt) write(localStorage, LOCAL_SEEN, new Date().toISOString());
  return remember(local());
}

/** The list was looked at: news until now is no longer new. */
export async function markSeen(): Promise<void> {
  const now = await loadScout();
  if (now.account) {
    const next = await call({ seen: true });
    if (next) remember(next);
    return;
  }
  write(localStorage, LOCAL_SEEN, new Date().toISOString());
  remember(local());
}

let newsTimes: Promise<Record<string, string>> | undefined;
/** Player id → his newest article's time (built with the site). */
export function playerNewsTimes(): Promise<Record<string, string>> {
  newsTimes ??= fetch("/data/player-news.json").then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  return newsTimes;
}

/** Scouted players with news since the list was last looked at. */
export async function unseen(state: ScoutState): Promise<number[]> {
  if (!state.ids.length) return [];
  const times = await playerNewsTimes();
  const since = Date.parse(state.seenAt ?? "") || 0;
  return state.ids.filter((id) => times[id] && Date.parse(times[id]) > since);
}
