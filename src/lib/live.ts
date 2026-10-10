import { sameClub } from "./odds.ts";

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

/** A game in LigaInsider's match bar (homepage): club slugs, the score once it started, and whether it's over. */
export type LiScore = { home: string; away: string; score?: [number, number]; finished: boolean };

export const LI_HOME_URL = "https://www.ligainsider.de/";

/**
 * Reads the match bar at the top of LigaInsider's homepage. "- : -" means not started; a game is over once
 * its player ratings ("Noten") are linked. Regex instead of a DOM parser: the Worker runs it on every refresh.
 */
export function parseLiScores(html: string): LiScore[] {
  const start = html.indexOf('id="carousel_slider_area"');
  if (start < 0) return [];
  return html.slice(start).split('<div class="item">').slice(1).flatMap((item) => {
    const clubs = [...item.matchAll(/class="item_info_icon float-(?:start|end)">\s*<a href="\/([a-z0-9-]+)\/\d+\/"/g)].map((m) => m[1]);
    if (clubs.length < 2) return [];
    const s = /<strong>\s*(\d+)\s*:\s*(\d+)\s*<\/strong>/.exec(item);
    return [{
      home: clubs[0],
      away: clubs[1],
      ...(s ? { score: [Number(s[1]), Number(s[2])] as [number, number] } : {}),
      finished: />\s*Noten\s*</i.test(item),
    }];
  });
}

/** ESPN's Bundesliga scoreboard (free, no key): the stand-in when LigaInsider's match bar is missing. */
export function espnUrl(now: Date): string {
  const day = (offset: number) => new Date(now.getTime() + offset * 86_400_000).toISOString().slice(0, 10).replaceAll("-", "");
  // The matchday so far (Friday to Sunday, or midweek) and the rest of today.
  return `https://site.api.espn.com/apis/site/v2/sports/soccer/ger.1/scoreboard?dates=${day(-3)}-${day(1)}`;
}

type EspnTeam = { homeAway: "home" | "away"; score?: string; team: { displayName: string } };
type EspnEvent = { date: string; status: { type: { state: string; completed: boolean } }; competitions: { competitors: EspnTeam[] }[] };

/** ESPN's games as our clubs (English names matched like the odds), in the match bar's shape. */
export function parseEspn(json: unknown, clubs: { name: string; slug: string }[]): LiScore[] {
  const events = (json as { events?: EspnEvent[] })?.events;
  if (!Array.isArray(events)) return [];
  const slug = (name: string) => clubs.find((c) => sameClub(c.name, name))?.slug;
  return events.flatMap((e) => {
    const teams = e.competitions?.[0]?.competitors ?? [];
    const home = teams.find((t) => t.homeAway === "home");
    const away = teams.find((t) => t.homeAway === "away");
    const hs = home && slug(home.team.displayName);
    const as = away && slug(away.team.displayName);
    if (!hs || !as || hs === as) return [];
    const started = e.status?.type?.state !== "pre";
    const score = [Number(home.score), Number(away.score)] as [number, number];
    return [{
      home: hs,
      away: as,
      ...(started && score.every(Number.isFinite) ? { score } : {}),
      finished: !!e.status?.type?.completed,
    }];
  });
}

/** LigaInsider's games, plus ESPN's for any game LigaInsider doesn't list. */
export function mergeScores(li: LiScore[], espn: LiScore[]): LiScore[] {
  return [...li, ...espn.filter((g) => !li.some((x) => x.home === g.home && x.away === g.away))];
}
