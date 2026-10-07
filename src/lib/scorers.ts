import type { Ref } from "../../scraper/types.ts";
import type { OddsEvent } from "../../scraper/odds.ts";
import type { ScorerMatch, ScorerPlayer } from "../../scraper/scorers.ts";
import type { Fixture } from "./fixtures.ts";
import { normalize } from "./match.ts";
import { expectedGoals, findEvent } from "./odds.ts";

/** Name words that identify a player ("de", "da" and initials don't). */
function words(s: string): string[] {
  return normalize(s).split(" ").filter((w) => w.length > 2);
}

/**
 * The bookmakers' spelling of a LigaInsider player ("Rômulo" → "Cardoso Romulo Jose").
 * Match on the surname (last word of the slug) or on two shared name words; never guess between ties.
 */
export function findScorer(player: Pick<Ref, "name" | "slug">, names: string[]): string | undefined {
  const own = new Set([...words(player.slug.replace(/-/g, " ")), ...words(player.name)]);
  const surname = words(player.slug.replace(/-/g, " ")).at(-1);
  const scored = names
    .map((name) => {
      const theirs = new Set(words(name));
      const shared = [...own].filter((w) => theirs.has(w)).length;
      const ok = (surname && theirs.has(surname)) || shared >= 2;
      return { name, shared: ok ? shared : 0 };
    })
    .filter((c) => c.shared > 0)
    .sort((a, b) => b.shared - a.shared);
  if (!scored.length || (scored[1] && scored[1].shared === scored[0].shared)) return undefined;
  return scored[0].name;
}

/** Share of goals scored by starters; substitutes score the rest. */
const STARTERS_SHARE = 0.85;
/** Typical bookmaker margin on goalscorer odds, used when the starters aren't known. */
const TYPICAL_MARGIN = 1.2;

/**
 * Chance to score per player (0–1). The odds are conditional on playing (bets are void otherwise) and include
 * the bookmaker margin. So the predicted starters' expected goals (−ln(1 − p)) are scaled to the share of the
 * match goals that starters score. Never scaled up: calibration only removes margin.
 */
export function calibrate(players: ScorerPlayer[], matchGoals: number, starters?: Set<string>): Map<string, number> {
  if (!starters?.size) return new Map(players.map((p) => [p.name, p.p / TYPICAL_MARGIN]));
  const xg = (p: number) => -Math.log(1 - Math.min(p, 0.95));
  const startersXg = players.filter((p) => starters.has(p.name)).reduce((s, p) => s + xg(p.p), 0);
  const scale = startersXg > 0 ? Math.min(1, (STARTERS_SHARE * matchGoals) / startersXg) : 1 / TYPICAL_MARGIN;
  return new Map(players.map((p) => [p.name, 1 - Math.exp(-xg(p.p) * scale)]));
}

/** For a fixture: a lookup from LigaInsider player to their chance to score, in whole percent. */
export function goalChances(
  f: Fixture, odds: OddsEvent[] | undefined, scorers: Record<string, ScorerMatch> | undefined,
): (player: Pick<Ref, "name" | "slug">) => number | undefined {
  const none = () => undefined;
  const result = findEvent(f, odds);
  const match = result?.event.id ? scorers?.[result.event.id] : undefined;
  if (!result || !match?.players.length) return none;
  const xg = expectedGoals(result.event.chances);
  const names = match.players.map((p) => p.name);
  // The predicted starters of both teams, in the bookmakers' spelling.
  const starters = new Set(
    [f.home, f.away].flatMap((l) => l?.lines.flat() ?? []).flatMap((p) => findScorer(p, names) ?? []),
  );
  const chances = calibrate(match.players, xg.home + xg.away, starters);
  return (player) => {
    const name = findScorer(player, names);
    return name === undefined ? undefined : Math.round(chances.get(name)! * 100);
  };
}
