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

export type Score = { home: number; away: number; percent: number };

const MAX_GOALS = 10;

/** Probability table P[i][j] of the score i:j when both teams score independently (Poisson). */
function scoreTable(lh: number, la: number): number[][] {
  const pmf = (l: number) => {
    const out = [Math.exp(-l)];
    for (let k = 1; k <= MAX_GOALS; k++) out.push((out[k - 1] * l) / k);
    return out;
  };
  const h = pmf(lh);
  const a = pmf(la);
  return h.map((ph) => a.map((pa) => ph * pa));
}

function outcomeError(lh: number, la: number, target: [number, number, number]): number {
  const t = scoreTable(lh, la);
  let home = 0, draw = 0, away = 0;
  for (let i = 0; i <= MAX_GOALS; i++) for (let j = 0; j <= MAX_GOALS; j++) {
    if (i > j) home += t[i][j]; else if (i === j) draw += t[i][j]; else away += t[i][j];
  }
  return (home - target[0]) ** 2 + (draw - target[1]) ** 2 + (away - target[2]) ** 2;
}

/**
 * The most likely exact result: expected goals for both teams are fitted to the win/draw/loss chances
 * (Poisson model), then the likeliest score is picked. Even that is rare (≈ 8–12 %), so show it as a tip.
 */
export function likelyScore(c: Chances): Score {
  const target: [number, number, number] = [c.home / 100, c.draw / 100, c.away / 100];
  // Coarse grid, then a finer one around the best point.
  let best = { lh: 1, la: 1, err: Infinity };
  const search = (from: [number, number], to: [number, number], step: number) => {
    for (let lh = from[0]; lh <= to[0]; lh += step) for (let la = from[1]; la <= to[1]; la += step) {
      const err = outcomeError(lh, la, target);
      if (err < best.err) best = { lh, la, err };
    }
  };
  search([0.1, 0.1], [5, 5], 0.05);
  search([Math.max(0.05, best.lh - 0.05), Math.max(0.05, best.la - 0.05)], [best.lh + 0.05, best.la + 0.05], 0.01);

  const t = scoreTable(best.lh, best.la);
  let top = { home: 0, away: 0, p: -1 };
  for (let i = 0; i <= MAX_GOALS; i++) for (let j = 0; j <= MAX_GOALS; j++) {
    if (t[i][j] > top.p) top = { home: i, away: j, p: t[i][j] };
  }
  return { home: top.home, away: top.away, percent: Math.round(top.p * 100) };
}
