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

/** Equal, or one letter off in a longer word ("Khannouss" / "Khannous"): spellings differ between sources. */
function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 6 || Math.abs(a.length - b.length) > 1) return false;
  // Edit distance ≤ 1 (one letter replaced, added or dropped).
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
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
      const theirs = words(name);
      const has = (w: string) => theirs.some((t) => sameWord(w, t));
      const shared = [...own].filter(has).length;
      const ok = (surname && has(surname)) || shared >= 2;
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
/** Assists per goal in the Bundesliga (most goals are assisted, some not). */
const ASSISTS_PER_GOAL = 0.7;
/** Bundesliga average of cards per match, and the share starters get. */
const CARDS_PER_MATCH = 4;
const STARTERS_CARD_SHARE = 0.8;

/** Expected events behind a "yes" chance (a player can score twice; −ln(1 − p) undoes that). */
const events = (p: number) => -Math.log(1 - Math.min(p, 0.95));
const chance = (lambda: number) => 1 - Math.exp(-lambda);

/**
 * Factor that removes the bookmaker margin: the predicted starters' expected events are scaled to `target`
 * (what starters really produce in this match). Never above 1: calibration only removes margin.
 */
function marginScale(players: ScorerPlayer[], target: number, starters?: Set<string>): number {
  if (!starters?.size) return 1 / TYPICAL_MARGIN;
  const startersEvents = players.filter((p) => starters.has(p.name)).reduce((s, p) => s + events(p.p), 0);
  return startersEvents > 0 ? Math.min(1, target / startersEvents) : 1 / TYPICAL_MARGIN;
}

/**
 * Chance to score per player (0–1). The odds are conditional on playing (bets are void otherwise) and include
 * the bookmaker margin. So the predicted starters' expected goals are scaled to the share of the match goals
 * that starters score.
 */
export function calibrate(players: ScorerPlayer[], matchGoals: number, starters?: Set<string>): Map<string, number> {
  if (!starters?.size) return new Map(players.map((p) => [p.name, p.p / TYPICAL_MARGIN]));
  const scale = marginScale(players, STARTERS_SHARE * matchGoals, starters);
  return new Map(players.map((p) => [p.name, chance(events(p.p) * scale)]));
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

/** Odds-based outlook for one player, in whole percent. */
export type PlayerInsight = {
  /** Scores. */
  goal?: number;
  /** Scores or assists (Kickbase "Scorer"). */
  scorer?: number;
  /** Gets a card. */
  card?: number;
};
export type MatchInsights = {
  player: (p: Pick<Ref, "name" | "slug">) => PlayerInsight;
  /** Chance to keep a clean sheet, in whole percent, for our fixture's home and away team. */
  cleanSheet: { home: number; away: number };
};

/**
 * Everything the odds say about one match. Clean sheets come from the team totals of the full fetch; without
 * them (or before Thursday) from the goal expectations behind the win chances.
 */
export function matchInsights(
  f: Fixture, odds: OddsEvent[] | undefined, scorers: Record<string, ScorerMatch> | undefined,
): MatchInsights | undefined {
  const found = findEvent(f, odds);
  if (!found) return undefined;
  const { event, flipped } = found;
  const xg = expectedGoals(event.chances);
  const match = event.id ? scorers?.[event.id] : undefined;

  // Clean sheets in the API's home/away, then turned to ours.
  const apiHome = match?.cleanSheet?.[event.home] ?? Math.exp(-xg.away);
  const apiAway = match?.cleanSheet?.[event.away] ?? Math.exp(-xg.home);
  const pct = (p: number) => Math.round(p * 100);
  const cleanSheet = flipped ? { home: pct(apiAway), away: pct(apiHome) } : { home: pct(apiHome), away: pct(apiAway) };

  const ours = [f.home, f.away].flatMap((l) => l?.lines.flat() ?? []);
  const lookup = (list: ScorerPlayer[] | undefined) => {
    const names = (list ?? []).map((p) => p.name);
    return { names, starters: new Set(ours.flatMap((p) => findScorer(p, names) ?? [])) };
  };
  const matchGoals = xg.home + xg.away;

  // Goals (US books).
  const goalL = lookup(match?.players);
  const goals = calibrate(match?.players ?? [], matchGoals, goalL.starters);
  // Assists, calibrated like the goals: the starters' expected assists scaled to the assists in this match.
  const assistL = lookup(match?.assists);
  const assistScale = marginScale(match?.assists ?? [], ASSISTS_PER_GOAL * STARTERS_SHARE * matchGoals, assistL.starters);
  // Cards (US books), scaled to the cards starters get in an average match.
  const cardL = lookup(match?.cards);
  const cardScale = marginScale(match?.cards ?? [], STARTERS_CARD_SHARE * CARDS_PER_MATCH, cardL.starters);

  const find = (list: ScorerPlayer[] | undefined, names: string[], p: Pick<Ref, "name" | "slug">) => {
    const name = findScorer(p, names);
    return name === undefined ? undefined : list!.find((x) => x.name === name);
  };
  return {
    cleanSheet,
    player: (p) => {
      const goalName = findScorer(p, goalL.names);
      const goal = goalName === undefined ? undefined : goals.get(goalName);
      const assist = find(match?.assists, assistL.names, p);
      const card = find(match?.cards, cardL.names, p);
      // Goal or assist: everything but "neither".
      const scorer = goal !== undefined && assist ? 1 - (1 - goal) * (1 - chance(events(assist.p) * assistScale)) : undefined;
      return {
        ...(goal !== undefined ? { goal: pct(goal) } : {}),
        ...(scorer !== undefined ? { scorer: pct(scorer) } : {}),
        ...(card ? { card: pct(chance(events(card.p) * cardScale)) } : {}),
      };
    },
  };
}
