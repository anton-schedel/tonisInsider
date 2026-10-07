import type { Chances, OddsEvent } from "../../scraper/odds.ts";
import type { Fixture } from "./fixtures.ts";
import { normalize } from "./match.ts";

/** Words that don't identify a club ("FC", "Borussia", years and numbers). */
const GENERIC = new Set(["fc", "sv", "sc", "tsg", "vfb", "vfl", "fsv", "rb", "borussia"]);
/** English spellings the odds API uses. */
const ALIASES: Record<string, string> = { munich: "munchen", cologne: "koln", hamburg: "hamburger", gladbach: "monchengladbach" };

function words(name: string): Set<string> {
  return new Set(
    normalize(name)
      .split(" ")
      .map((w) => ALIASES[w] ?? w)
      .filter((w) => w && !GENERIC.has(w) && !/^\d+$/.test(w)),
  );
}

/** Same club if the names share a distinctive word ("FC Bayern München" / "Bayern Munich"). */
export function sameClub(ours: string, theirs: string): boolean {
  const a = words(ours);
  return [...words(theirs)].some((w) => a.has(w));
}

/** The same pairing can come round again later in the season; only accept odds within 3 days of our kickoff. */
const MAX_KICKOFF_GAP_MS = 3 * 24 * 60 * 60_000;

/** Win chances for a fixture, from our home team's point of view. */
export function chancesFor(f: Fixture, events: OddsEvent[] | undefined): Chances | undefined {
  if (!events || !f.homeName || !f.awayName) return undefined;
  const near = (e: OddsEvent) => !f.kickoff || Math.abs(Date.parse(e.kickoff) - Date.parse(f.kickoff)) <= MAX_KICKOFF_GAP_MS;
  const sorted = [...events].sort((a, b) => a.kickoff.localeCompare(b.kickoff));
  for (const e of sorted) {
    if (!near(e)) continue;
    if (sameClub(f.homeName, e.home) && sameClub(f.awayName, e.away)) return e.chances;
    if (sameClub(f.homeName, e.away) && sameClub(f.awayName, e.home)) {
      return { home: e.chances.away, draw: e.chances.draw, away: e.chances.home };
    }
  }
  return undefined;
}
