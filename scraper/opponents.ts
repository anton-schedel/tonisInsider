import type { Lineup } from "./types.ts";
import { sameClub } from "../src/lib/odds.ts";

/**
 * LigaInsider's match header (during and after a game) names clubs short ("Mönchengladbach"); the opponent is
 * stored with the club's full name ("Borussia Mönchengladbach"), so both sides of a match find each other.
 */
export function canonicalOpponent(name: string, clubNames: string[]): string {
  if (clubNames.includes(name)) return name;
  const hits = clubNames.filter((c) => sameClub(c, name));
  return hits.length === 1 ? hits[0] : name;
}

/**
 * Clubs whose page didn't name the opponent (LigaInsider sometimes shows a broken match page, or none, around
 * kickoff) get it from the other side: if Mainz plays Leverkusen at home, Leverkusen plays Mainz away, same
 * kickoff and matchday. Returns the lineups that were filled in.
 */
export function fillOpponents(lineups: Lineup[]): Lineup[] {
  const filled: Lineup[] = [];
  for (const l of lineups) {
    if (l.opponent?.name) continue;
    const other = lineups.find((o) => !!o.opponent?.name && sameClub(l.club.name, o.opponent.name));
    if (!other?.opponent) continue;
    l.opponent = { name: other.club.name, home: !other.opponent.home };
    l.kickoff ??= other.kickoff;
    l.matchday ??= other.matchday;
    filled.push(l);
  }
  return filled;
}

export type ScheduledGame = { home: string; away: string; kickoff: string };

/**
 * The last resort when neither side's page names the match (both pages down): the matchday's schedule from
 * another source (OpenLigaDB, which uses LigaInsider's club names). Returns the lineups that were filled in.
 */
export function fillFromSchedule(lineups: Lineup[], games: ScheduledGame[]): Lineup[] {
  const filled: Lineup[] = [];
  for (const l of lineups) {
    if (l.opponent?.name) continue;
    const g = games.find((x) => x.home === l.club.name || x.away === l.club.name);
    if (!g) continue;
    const home = g.home === l.club.name;
    l.opponent = { name: home ? g.away : g.home, home };
    l.kickoff ??= g.kickoff;
    filled.push(l);
  }
  return filled;
}
