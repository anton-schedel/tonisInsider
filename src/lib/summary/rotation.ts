import type { HistMatch, HistPlayer } from "../../../scraper/kbHistory.ts";
import type { CupGame } from "../../../scraper/cupGames.ts";
import { sameClub } from "../odds.ts";

export const NEAR_DAYS = 3;
/** At least this many past Bundesliga games next to a cup game before saying anything. */
export const MIN_NEAR = 2;
/** His start rate next to cup games at least 25 points below the rest. */
export const DROP = 0.25;

const DAY = 86_400_000;

/** The club's European or cup game within three days of `date` (Kickbase's club name against the list's spelling). */
export const cupGameNear = (games: CupGame[], clubName: string, date: string): CupGame | undefined =>
  games.find((g) => (sameClub(clubName, g.home) || sameClub(clubName, g.away)) && Math.abs(Date.parse(g.kickoff) - Date.parse(date)) <= NEAR_DAYS * DAY);

export type Rotation = { near: CupGame; nearStarts: number; nearGames: number; usualRate: number };

/** At risk: a cup game is near this kickoff, and before, next to such games, he started clearly less often. */
export function rotationRisk(p: HistPlayer, clubName: string, matches: Record<string, HistMatch>, cupGames: CupGame[], kickoff: string): Rotation | undefined {
  const near = cupGameNear(cupGames, clubName, kickoff);
  if (!near) return undefined;
  // His games for this club (the cup list is about his current one).
  const past = p.games
    .filter((g) => (g.team ?? p.team) === p.team && matches[g.matchId] && matches[g.matchId].date < kickoff)
    .map((g) => ({ start: g.start, near: !!cupGameNear(cupGames, clubName, matches[g.matchId].date) }));
  const nearGames = past.filter((g) => g.near);
  const usual = past.filter((g) => !g.near);
  if (nearGames.length < MIN_NEAR || !usual.length) return undefined;
  const nearStarts = nearGames.filter((g) => g.start).length;
  const usualRate = usual.filter((g) => g.start).length / usual.length;
  return usualRate - nearStarts / nearGames.length >= DROP ? { near, nearStarts, nearGames: nearGames.length, usualRate } : undefined;
}
