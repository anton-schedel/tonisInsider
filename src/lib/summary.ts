import type { MyPlayer, StartStatus } from "./match.ts";

export type TeamSummary = {
  /** In LigaInsider's predicted XI (sure, with an alternative named, or doubtful). */
  starting: number;
  /** Of those: an alternative is named, or they're doubtful. */
  shaky: number;
  /** Not in the predicted XI (listed as alternative or on the bench). */
  out: number;
  unknown: number;
  total: number;
  /** One status per player in pitch order, for the strip of dots. */
  statuses: StartStatus[];
  /** Expected number of scorers among them (sum of the goal chances), if any chances are known. */
  scorers?: number;
};

export function teamSummary(players: MyPlayer[], goals: Map<string, number>): TeamSummary {
  const count = (...s: StartStatus[]) => players.filter((p) => s.includes(p.status)).length;
  const chances = players.map((p) => goals.get(p.kickbase.id)).filter((x): x is number => x !== undefined);
  return {
    starting: count("start", "contested", "doubtful"),
    shaky: count("contested", "doubtful"),
    out: count("alternative", "bench"),
    unknown: count("unknown"),
    total: players.length,
    statuses: players.map((p) => p.status),
    scorers: chances.length ? Math.round(chances.reduce((s, x) => s + x, 0)) / 100 : undefined,
  };
}
