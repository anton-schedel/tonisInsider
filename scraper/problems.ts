/**
 * One-off glitches fix themselves (a lineup LigaInsider is half-way through editing, an empty page during
 * maintenance), so a problem only fails the run once it showed up in 3 runs in a row (≈15 minutes).
 * Article problems are reported at once: a broken article is reported a single time and then skipped.
 */
export const RUNS_BEFORE_REPORTING = 3;

/** "lineup eintracht-frankfurt: expected 11 players, got 10" → "lineup eintracht-frankfurt" (details may change between runs). */
const keyOf = (problem: string) => problem.split(": ")[0];

export function lastingProblems(
  problems: string[],
  streaks: Record<string, number>,
): { report: string[]; streaks: Record<string, number> } {
  const next: Record<string, number> = {};
  for (const p of problems) next[keyOf(p)] = (streaks[keyOf(p)] ?? 0) + 1;
  const report = problems.filter((p) => p.startsWith("article ") || next[keyOf(p)] >= RUNS_BEFORE_REPORTING);
  return { report, streaks: next };
}
