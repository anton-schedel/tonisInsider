import type { Lineup } from "../../scraper/types.ts";
import { sameClub } from "./odds.ts";

export type Fixture = {
  home?: Lineup;
  away?: Lineup;
  homeName: string;
  awayName: string;
  kickoff?: string;
};

/** Pairs lineups into matches via each club's next opponent. Sorted by kickoff; unknown opponents last. */
export function toFixtures(lineups: Lineup[]): Fixture[] {
  const byName = new Map(lineups.map((l) => [l.club.name, l]));
  const used = new Set<Lineup>();
  const fixtures: Fixture[] = [];

  for (const l of lineups) {
    if (used.has(l)) continue;
    used.add(l);
    if (!l.opponent?.name) {
      fixtures.push({ home: l, away: undefined, homeName: l.club.name, awayName: "", kickoff: l.kickoff });
      continue;
    }
    // Exact name, else the same club spelled differently ("Mönchengladbach" / "Borussia Mönchengladbach").
    const name = l.opponent.name;
    const other = byName.get(name) ?? lineups.find((o) => o !== l && sameClub(o.club.name, name));
    const partner = other && !used.has(other) && !!other.opponent?.name && sameClub(l.club.name, other.opponent.name) ? other : undefined;
    if (partner) used.add(partner);
    const [home, away] = l.opponent.home ? [l, partner] : [partner, l];
    fixtures.push({
      home,
      away,
      homeName: l.opponent.home ? l.club.name : (partner?.club.name ?? l.opponent.name),
      awayName: l.opponent.home ? (partner?.club.name ?? l.opponent.name) : l.club.name,
      kickoff: l.kickoff,
    });
  }

  return fixtures.sort(
    (a, b) =>
      Number(!a.awayName) - Number(!b.awayName) ||
      (a.kickoff ?? "9999").localeCompare(b.kickoff ?? "9999") ||
      a.homeName.localeCompare(b.homeName, "de"),
  );
}
