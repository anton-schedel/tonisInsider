/**
 * One-off glitches fix themselves (a lineup LigaInsider is half-way through editing, an empty page during
 * maintenance), so a problem only fails the run once it showed up in 3 runs in a row (≈15 minutes).
 * A lasting problem is reported once (one email), then again once a day while it lasts. Article problems
 * (a page our parser can't read) are reported at once: such an article is reported a single time and then
 * skipped. An article that fails to download ("download article …", e.g. LigaInsider's own HTTP 500) counts
 * like any other glitch.
 */
export const RUNS_BEFORE_REPORTING = 3;
/** One day of runs (every 5 minutes). */
export const RUNS_BETWEEN_REMINDERS = 288;

/** "lineup eintracht-frankfurt: expected 11 players, got 10" → "lineup eintracht-frankfurt" (details may change between runs). */
const keyOf = (problem: string) => problem.split(": ")[0];

export function lastingProblems(
  problems: string[],
  streaks: Record<string, number>,
): { report: string[]; streaks: Record<string, number> } {
  const next: Record<string, number> = {};
  for (const p of problems) next[keyOf(p)] = (streaks[keyOf(p)] ?? 0) + 1;
  const due = (n: number) => n >= RUNS_BEFORE_REPORTING && (n - RUNS_BEFORE_REPORTING) % RUNS_BETWEEN_REMINDERS === 0;
  const report = problems.filter((p) => p.startsWith("article ") || due(next[keyOf(p)]));
  return { report, streaks: next };
}
