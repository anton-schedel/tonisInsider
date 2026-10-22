/**
 * The scout list in the browser: saved with the Kickbase or LigaInsider account (/api/scout/), else in this
 * browser only. A list started without a login moves into the account at the next login.
 */
export type ScoutState = {
  ids: number[];
  /** When each player was put on the list: news before that isn't new. */
  added?: Record<string, string>;
  seenAt?: string;
  account: boolean;
};

const LOCAL = "scoutList";
const LOCAL_SEEN = "scoutSeen";
const LOCAL_ADDED = "scoutAdded";
/** This tab's copy, so moving between pages doesn't ask the server each time. */
const SESSION = "scoutState";
/** The last known list, shown at once on the next visit while the account's list loads. */
const LAST = "scoutLast";
const SESSION_MS = 60_000;

const read = <T>(store: Storage, key: string): T | undefined => {
  try { const v = store.getItem(key); return v ? (JSON.parse(v) as T) : undefined; } catch { return undefined; }
};
const write = (store: Storage, key: string, value: unknown) => {
  try { value === undefined ? store.removeItem(key) : store.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
};

const local = (): ScoutState => ({
  ids: read<number[]>(localStorage, LOCAL) ?? [],
  added: read<Record<string, string>>(localStorage, LOCAL_ADDED) ?? {},
  seenAt: read<string>(localStorage, LOCAL_SEEN),
  account: false,
});
const remember = (s: ScoutState) => {
  write(sessionStorage, SESSION, { at: Date.now(), state: s });
  write(localStorage, LAST, s);
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
    const data = (await res.json()) as { ids: number[]; added?: Record<string, string>; seenAt?: string };
    return { ids: data.ids, added: data.added, seenAt: data.seenAt, account: true };
  } catch {
    return undefined;
  }
}

const loggedIn = () => /(?:^|; )(?:kbin|liin)=1/.test(document.cookie);

/** Right away, without asking the server: this tab's copy, else the last known list. */
export function cachedScout(): ScoutState {
  const last = read<{ state: ScoutState }>(sessionStorage, SESSION)?.state ?? read<ScoutState>(localStorage, LAST);
  return last && last.account === loggedIn() ? last : local();
}

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
      write(localStorage, LOCAL_ADDED, undefined);
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
  const added = { ...now.added };
  if (on) added[id] = new Date().toISOString();
  else delete added[id];
  write(localStorage, LOCAL, ids);
  write(localStorage, LOCAL_ADDED, added);
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

/** Scouted players with news since the list was last looked at (times: player id → newest news, if known). */
export async function unseen(state: ScoutState, known?: Record<string, string>): Promise<number[]> {
  if (!state.ids.length) return [];
  const times = known ?? (await playerNewsTimes());
  const seen = Date.parse(state.seenAt ?? "") || 0;
  return state.ids.filter((id) => times[id] && Date.parse(times[id]) > Math.max(seen, Date.parse(state.added?.[id] ?? "") || 0));
}
