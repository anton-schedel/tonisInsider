import type { KbEvent, KbPerfMatch, KbTeam } from "../src/lib/kickbase.ts";

/**
 * Every Bundesliga player's games this season from Kickbase: minutes, start, points and the points per event type
 * (grouped into attack, duels, … only where it's read, so the grouping can change without fetching again), plus
 * every match's result (home/away strength and form). One backfill, then each club's new matches as they're played.
 */
export type HistMatch = { day: number; date: string; home: string; away: string; homeGoals?: number; awayGoals?: number };
/** team: his club in that match (a winter transfer changes HistPlayer.team, not his old games). */
export type HistGame = { day: number; matchId: string; team?: string; minutes: number; start: boolean; points: number; events?: Record<string, number> };
export type HistPlayer = { name: string; team: string; position: number; games: HistGame[] };
export type KbHistory = {
  /** HISTORY_VERSION when written; an older file is fetched afresh (v1 had every game's events from the latest match). */
  version?: number;
  /** Kickbase's season ("2026/2027"): a new one starts the history afresh (only this season counts). */
  season?: string;
  /** Kickbase team id → name and matches played when its players were last refreshed. */
  teams: Record<string, { name: string; played: number }>;
  matches: Record<string, HistMatch>;
  players: Record<string, HistPlayer>;
  /** Players whose new matches are still to be fetched (a run stops at its request budget). */
  queue: string[];
  checkedAt?: string;
};

export type HistoryApi = {
  table(): Promise<KbTeam[]>;
  squad(teamId: string): Promise<{ id: string; name: string; position: number }[]>;
  performance(playerId: string): Promise<{ season: string; matches: KbPerfMatch[] }>;
  events(playerId: string, matchId: string): Promise<KbEvent[]>;
};

const CHECK_EVERY_MS = 12 * 3600_000;
/** Kickbase's "Startelf" bonus and its "played from the start" marker. */
const STARTED = new Set([4237, -8]);

export const HISTORY_VERSION = 3;

export const emptyHistory = (): KbHistory => ({ version: HISTORY_VERSION, teams: {}, matches: {}, players: {}, queue: [] });

/** The stored history, or a fresh one if there's none or it was written by older code. */
export const loadHistory = (json: string | undefined): KbHistory => {
  const h = json ? (JSON.parse(json) as KbHistory) : undefined;
  return h?.version === HISTORY_VERSION ? h : emptyHistory();
};

/** Anything to do this run: players queued, or the table not checked for 12 hours. Else not even a login. */
export const historyDue = (h: KbHistory, now: Date) =>
  h.queue.length > 0 || !h.checkedAt || now.getTime() - Date.parse(h.checkedAt) >= CHECK_EVERY_MS;

/** One finished match of a player; `events` undefined when he didn't play. */
export function gameOf(m: KbPerfMatch, events: KbEvent[] | undefined): HistGame {
  const game: HistGame = { day: m.day, matchId: m.matchId, ...(m.team ? { team: m.team } : {}), minutes: m.minutes ?? 0, start: false, points: m.points ?? 0 };
  if (!events) return game;
  const sums: Record<string, number> = {};
  for (const e of events) {
    if (STARTED.has(e.type)) game.start = true;
    // Negative types are Kickbase's bookkeeping (half time, substitution) and score nothing.
    if (e.type > 0 && e.points) sums[e.type] = (sums[e.type] ?? 0) + e.points;
  }
  return { ...game, events: sums };
}

/** Brings the history up to date within `budget` Kickbase requests; what's left goes on in the next run. */
export async function updateHistory(h: KbHistory, api: HistoryApi, now: Date, budget: number): Promise<{ changed: boolean; requests: number }> {
  let requests = 0;
  let changed = false;
  const can = () => requests < budget;
  const ask = <T>(p: () => Promise<T>) => { requests++; return p(); };

  // Twice a day: which clubs played since, and their current squads (transfers, new players).
  if (!h.checkedAt || now.getTime() - Date.parse(h.checkedAt) >= CHECK_EVERY_MS) {
    if (!can()) return { changed, requests };
    const table = await ask(() => api.table());
    let complete = true;
    for (const t of table) {
      const played = t.played ?? 0;
      if (h.teams[t.id]?.played === played) continue;
      if (!can()) { complete = false; break; }
      for (const p of await ask(() => api.squad(t.id))) {
        const known = h.players[p.id];
        h.players[p.id] = { name: p.name, team: t.id, position: p.position, games: known?.games ?? [] };
        if (!h.queue.includes(p.id)) h.queue.push(p.id);
      }
      h.teams[t.id] = { name: t.name, played };
      changed = true;
    }
    if (complete) { h.checkedAt = now.toISOString(); changed = true; }
  }

  // Each queued player's finished matches that aren't stored yet.
  const seen = new Set<string>();
  while (h.queue.length && can() && !seen.has(h.queue[0])) {
    const id = h.queue[0];
    seen.add(id);
    const player = h.players[id];
    if (!player) { h.queue.shift(); changed = true; continue; }
    const { season, matches } = await ask(() => api.performance(id));
    if (season && season !== h.season) {
      // A new season: last season's games and results go, and every squad is read again.
      if (h.season) {
        for (const p of Object.values(h.players)) p.games = [];
        h.matches = {};
        h.teams = {};
        h.checkedAt = undefined;
      }
      h.season = season;
      changed = true;
    }
    let done = true;
    // A match still running is fetched once it's over: he stays queued (at the back, not blocking the others).
    let running = false;
    for (const m of matches) {
      if (m.state === 1) running = true;
      if (m.state !== 2) continue;
      if (!h.matches[m.matchId]) {
        h.matches[m.matchId] = {
          day: m.day, date: m.date, home: m.home, away: m.away,
          ...(m.homeGoals !== undefined ? { homeGoals: m.homeGoals } : {}),
          ...(m.awayGoals !== undefined ? { awayGoals: m.awayGoals } : {}),
        };
        changed = true;
      }
      if (player.games.some((g) => g.matchId === m.matchId)) continue;
      // Kickbase gives a substitute who stayed on the bench 0 minutes: no events to ask for.
      const played = (m.minutes ?? 0) > 0;
      if (played && !can()) { done = false; break; }
      player.games.push(gameOf(m, played ? await ask(() => api.events(id, m.matchId)) : undefined));
      player.games.sort((a, b) => a.day - b.day);
      changed = true;
    }
    if (!done) break;
    h.queue.shift();
    if (running) h.queue.push(id);
    changed = true;
  }
  return { changed, requests };
}
