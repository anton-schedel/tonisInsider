import type { Lineup } from "./types.ts";

/**
 * Clubs whose page didn't name the opponent (LigaInsider sometimes shows a broken match page, or none, around
 * kickoff) get it from the other side: if Mainz plays Leverkusen at home, Leverkusen plays Mainz away, same
 * kickoff and matchday. Returns the lineups that were filled in.
 */
export function fillOpponents(lineups: Lineup[]): Lineup[] {
  const filled: Lineup[] = [];
  for (const l of lineups) {
    if (l.opponent?.name) continue;
    const other = lineups.find((o) => o.opponent?.name === l.club.name);
    if (!other?.opponent) continue;
    l.opponent = { name: other.club.name, home: !other.opponent.home };
    l.kickoff ??= other.kickoff;
    l.matchday ??= other.matchday;
    filled.push(l);
  }
  return filled;
}
