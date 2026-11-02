import type { KbHistory } from "../../../scraper/kbHistory.ts";
import type { SavedPrediction } from "../../../scraper/predictions.ts";
import type { CupGame } from "../../../scraper/cupGames.ts";
import type { Lineup } from "../../../scraper/types.ts";
import type { KbTeam } from "../kickbase.ts";
import { mapClubs, type MyPlayer, type StartStatus } from "../match.ts";
import { toFixtures } from "../fixtures.ts";
import { contextOf, matchupIndex, profileOf } from "./profile.ts";
import { reliabilityByClub } from "./reliability.ts";
import { rotationRisk } from "./rotation.ts";
import { formBefore } from "./teamForm.ts";
import type { SummaryInput, SummaryPlayer } from "./compose.ts";

const IN_XI = new Set<StartStatus>(["confirmed", "start", "contested", "doubtful"]);
const weekday = (iso: string) => new Intl.DateTimeFormat("de-DE", { weekday: "long", timeZone: "Europe/Berlin" }).format(new Date(iso));

/** The matchday most clubs' lineups are on, and its first kickoff (a club still showing last weekend doesn't count). */
function firstKickoffOf(lineups: Lineup[]): string | undefined {
  const count = new Map<number, number>();
  for (const l of lineups) if (l.matchday !== undefined) count.set(l.matchday, (count.get(l.matchday) ?? 0) + 1);
  const matchday = [...count].sort((a, b) => b[1] - a[1])[0]?.[0];
  return lineups.filter((l) => l.matchday === matchday && l.kickoff).map((l) => l.kickoff!).sort()[0];
}

/** Everything the summary says about the manager's squad, from the data the page has anyway. */
export function summaryInput(args: {
  now: Date; players: MyPlayer[]; history: KbHistory | undefined; lineups: Lineup[];
  predictions: SavedPrediction[]; cupGames: CupGame[]; table: KbTeam[];
}): SummaryInput {
  const { history, lineups, table } = args;
  const clubs = mapClubs(table, lineups);
  const kbTeamOf = new Map([...clubs].map(([kbId, l]) => [l.club.slug, kbId]));
  const fixtures = toFixtures(lineups);

  const players = args.players.map((p): SummaryPlayer => {
    const base: SummaryPlayer = {
      name: p.kickbase.name,
      inPredictedXi: IN_XI.has(p.status),
      ...(p.lineup ? { clubSlug: p.lineup.club.slug, clubName: p.lineup.club.name } : {}),
    };
    const hp = history?.players[p.kickbase.id];
    if (!history || !hp) return base;
    const profile = profileOf(hp, history.matches);
    const fixture = p.lineup && fixtures.find((f) => f.home === p.lineup || f.away === p.lineup);
    if (!fixture?.kickoff) return { ...base, ...(profile ? { profile } : {}) };

    let matchup: SummaryPlayer["matchup"];
    if (profile) {
      const home = fixture.home === p.lineup;
      const opponent = home ? fixture.away : fixture.home;
      const opponentId = opponent && kbTeamOf.get(opponent.club.slug);
      const opponentForm = opponentId ? formBefore(history.matches, opponentId, fixture.kickoff) : undefined;
      const context = { home, opponent: contextOf(opponentForm, !home) };
      const mi = matchupIndex(profile, context);
      if (mi) matchup = { ...mi, context, opponentName: home ? fixture.awayName : fixture.homeName, ...(opponentForm ? { opponentForm } : {}), day: weekday(fixture.kickoff) };
    }
    const clubName = table.find((t) => t.id === p.kickbase.teamId)?.name;
    const rotation = clubName ? rotationRisk(hp, clubName, history.matches, args.cupGames, fixture.kickoff) : undefined;
    return { ...base, ...(profile ? { profile } : {}), ...(matchup ? { matchup } : {}), ...(rotation ? { rotation } : {}) };
  });

  return {
    now: args.now,
    firstKickoff: firstKickoffOf(lineups),
    players,
    reliability: history ? reliabilityByClub(args.predictions, history, (slug) => kbTeamOf.get(slug)) : new Map(),
  };
}
