/** Win chances from bookmaker odds (The Odds API, free plan: 500 requests a month). */

const MINUTE = 60_000;
/** Every 2 hours ≈ 360 requests a month, safely under the free 500. */
const INTERVAL_MIN = 120;

export type Chances = { home: number; draw: number; away: number };
/** One Bundesliga match with its chances in whole percent (summing to 100), names as the API spells them. */
export type OddsEvent = { home: string; away: string; kickoff: string; chances: Chances; books: number };

export const oddsUrl = (apiKey: string) =>
  `https://api.the-odds-api.com/v4/sports/soccer_germany_bundesliga/odds/?apiKey=${encodeURIComponent(apiKey)}&regions=eu&markets=h2h&oddsFormat=decimal`;

export function oddsDue(lastFetchedAt: string | undefined, now: Date): boolean {
  if (!lastFetchedAt) return true;
  return now.getTime() - Date.parse(lastFetchedAt) >= (INTERVAL_MIN - 1) * MINUTE;
}

type ApiOutcome = { name?: string; price?: number };
type ApiEvent = {
  home_team?: string;
  away_team?: string;
  commence_time?: string;
  bookmakers?: { markets?: { key?: string; outcomes?: ApiOutcome[] }[] }[];
};

/** Whole percentages that add up to exactly 100 (largest remainder). */
function percentages(p: [number, number, number]): Chances {
  const raw = p.map((x) => x * 100);
  const out = raw.map(Math.floor);
  const order = raw.map((x, i) => [x - Math.floor(x), i] as const).sort((a, b) => b[0] - a[0]);
  const missing = 100 - out.reduce((s, x) => s + x, 0);
  for (let k = 0; k < missing; k++) out[order[k][1]]++;
  return { home: out[0], draw: out[1], away: out[2] };
}

export function parseOdds(json: unknown): OddsEvent[] {
  if (!Array.isArray(json)) return [];
  const events: OddsEvent[] = [];
  for (const e of json as ApiEvent[]) {
    if (!e.home_team || !e.away_team || !e.commence_time) continue;
    // Per bookmaker: implied probabilities 1/odds, normalised to remove the margin. Then averaged.
    const fair: [number, number, number][] = [];
    for (const b of e.bookmakers ?? []) {
      const outcomes = b.markets?.find((m) => m.key === "h2h")?.outcomes ?? [];
      const price = (name: string) => outcomes.find((o) => o.name === name)?.price ?? 0;
      const odds = [price(e.home_team), price("Draw"), price(e.away_team)];
      if (odds.some((o) => !(o > 1))) continue;
      const implied = odds.map((o) => 1 / o);
      const sum = implied.reduce((s, x) => s + x, 0);
      fair.push(implied.map((x) => x / sum) as [number, number, number]);
    }
    if (!fair.length) continue;
    const avg = [0, 1, 2].map((i) => fair.reduce((s, f) => s + f[i], 0) / fair.length) as [number, number, number];
    events.push({ home: e.home_team, away: e.away_team, kickoff: e.commence_time, chances: percentages(avg), books: fair.length });
  }
  return events;
}

/** True if the percentages shown on the site would not change. */
export function sameOdds(a: OddsEvent[] | undefined, b: OddsEvent[]): boolean {
  const key = (list: OddsEvent[]) =>
    JSON.stringify(list.map((e) => [e.home, e.away, e.kickoff, e.chances]).sort());
  return !!a && key(a) === key(b);
}
