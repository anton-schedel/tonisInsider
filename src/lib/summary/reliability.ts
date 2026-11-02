import type { KbHistory } from "../../../scraper/kbHistory.ts";
import type { SavedPrediction } from "../../../scraper/predictions.ts";
import { nameMatches, normalize } from "../match.ts";

export const MIN_MATCHDAYS = 3;

/** hits: how many of LigaInsider's 11 predicted starters started, on average. */
export type Reliability = { matchdays: number; hits: number };

const DAY = 86_400_000;

/**
 * Per LigaInsider club: its prediction as saved before the matchday's lineup lock against who started (Kickbase).
 * `kbTeamOf` turns a LigaInsider club slug into its Kickbase team id (mapClubs).
 */
export function reliabilityByClub(predictions: SavedPrediction[], history: KbHistory, kbTeamOf: (slug: string) => string | undefined): Map<string, Reliability> {
  const hits = new Map<string, number[]>();
  const matches = Object.entries(history.matches);
  for (const p of predictions) {
    for (const [slug, club] of Object.entries(p.clubs)) {
      const team = kbTeamOf(slug);
      if (!team || !club.kickoff || !club.xi.length) continue;
      const kickoff = Date.parse(club.kickoff);
      const match = matches.find(([, m]) => (m.home === team || m.away === team) && Math.abs(Date.parse(m.date) - kickoff) <= DAY)?.[0];
      if (!match) continue;
      const starters = Object.values(history.players).flatMap((pl) =>
        pl.games.some((g) => g.matchId === match && (g.team ?? pl.team) === team && g.start) ? [pl.name] : []);
      if (!starters.length) continue;
      const right = club.xi.filter((x) => starters.some((n) => nameMatches(n, { id: x.id, slug: normalize(x.name).replace(/ /g, "-"), name: x.name }))).length;
      hits.set(slug, [...(hits.get(slug) ?? []), right]);
    }
  }
  return new Map([...hits].filter(([, list]) => list.length >= MIN_MATCHDAYS)
    .map(([slug, list]) => [slug, { matchdays: list.length, hits: list.reduce((a, b) => a + b, 0) / list.length }]));
}
