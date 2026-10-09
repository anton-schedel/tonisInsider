/** Live scores from OpenLigaDB (free, community-maintained, open CORS): fetched by the browser while games run. */
export const LIVE_URL = "https://api.openligadb.de/getmatchdata/bl1";

type OldbGoal = { scoreTeam1: number; scoreTeam2: number; matchMinute: number | null; goalGetterName: string; isPenalty: boolean; isOwnGoal: boolean };
type OldbMatch = {
  matchDateTimeUTC: string;
  team1: { teamName: string };
  team2: { teamName: string };
  matchIsFinished: boolean;
  matchResults: { resultOrderID: number; pointsTeam1: number; pointsTeam2: number }[];
  goals: OldbGoal[];
};

export type LiveGoal = { minute?: number; name: string; home: number; away: number; penalty: boolean; own: boolean };
export type LiveMatch = { home: string; away: string; kickoff: string; finished: boolean; score: [number, number]; goals: LiveGoal[] };

const key = (name: string) => name.trim().toLowerCase();

/** OpenLigaDB's current matchday, reduced to what we show. The score is the latest goal or result, else 0:0. */
export function parseLive(json: unknown): LiveMatch[] {
  if (!Array.isArray(json)) return [];
  return (json as OldbMatch[]).flatMap((m) => {
    if (!m?.team1?.teamName || !m.team2?.teamName || !m.matchDateTimeUTC) return [];
    const goals = (m.goals ?? []).map((g) => ({
      minute: g.matchMinute ?? undefined,
      name: g.goalGetterName,
      home: g.scoreTeam1,
      away: g.scoreTeam2,
      penalty: !!g.isPenalty,
      own: !!g.isOwnGoal,
    }));
    const result = [...(m.matchResults ?? [])].sort((a, b) => b.resultOrderID - a.resultOrderID)[0];
    const last = goals.at(-1);
    // Results are entered after the half and the match; goals as they happen. Take whichever is further on.
    const fromGoals: [number, number] = last ? [last.home, last.away] : [0, 0];
    const fromResult: [number, number] = result ? [result.pointsTeam1, result.pointsTeam2] : [0, 0];
    const score = fromResult[0] + fromResult[1] > fromGoals[0] + fromGoals[1] ? fromResult : fromGoals;
    return [{ home: m.team1.teamName, away: m.team2.teamName, kickoff: new Date(m.matchDateTimeUTC).toISOString(), finished: !!m.matchIsFinished, score, goals }];
  });
}
