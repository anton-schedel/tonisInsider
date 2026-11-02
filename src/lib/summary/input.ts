import type { KbHistory } from "../../../scraper/kbHistory.ts";
import type { SavedPrediction } from "../../../scraper/predictions.ts";
import type { CupGame } from "../../../scraper/cupGames.ts";
import type { Lineup } from "../../../scraper/types.ts";
import type { KbTeam } from "../kickbase.ts";
import { mapClubs, type MyPlayer, type StartStatus } from "../match.ts";
import { toFixtures } from "../fixtures.ts";
import { contextOf, matchupIndex, MIN_FORM_GAMES, profileOf } from "./profile.ts";
import { reliabilityByClub, type Reliability } from "./reliability.ts";
import { rotationRisk } from "./rotation.ts";
import { formBefore } from "./teamForm.ts";
import type { SummaryInput, SummaryPlayer } from "./compose.ts";

const IN_XI = new Set<StartStatus>(["confirmed", "start", "contested", "doubtful"]);

/**
 * The history and the snapshot's predictions are read once per Worker isolate and build, so the reliability
 * (tens of ms by the end of a season) is worked out once for them too, not on every page load.
 */
const reliabilityCache = new WeakMap<KbHistory, { predictions: SavedPrediction[]; result: Map<string, Reliability> }>();
const weekday = (iso: string) => new Intl.DateTimeFormat("de-DE", { weekday: "long", timeZone: "Europe/Berlin" }).format(new Date(iso));

/** The matchday most clubs' lineups are on (a club still showing last weekend doesn't count). */
function currentMatchday(lineups: Lineup[]): number | undefined {
  const count = new Map<number, number>();
  for (const l of lineups) if (l.matchday !== undefined) count.set(l.matchday, (count.get(l.matchday) ?? 0) + 1);
  return [...count].sort((a, b) => b[1] - a[1])[0]?.[0];
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
  const matchday = currentMatchday(lineups);

  const players = args.players.map((p): SummaryPlayer => {
    const base: SummaryPlayer = {
      name: p.kickbase.name,
      inPredictedXi: IN_XI.has(p.status),
      ...(p.lineup ? { clubSlug: p.lineup.club.slug, clubName: p.lineup.club.name } : {}),
    };
    const hp = history?.players[p.kickbase.id];
    if (!history || !hp) return base;
    const profile = profileOf(hp, history.matches);
    // Only this matchday's game, before it starts: a club whose page still shows last weekend says nothing.
    const fixture = p.lineup?.matchday === matchday ? fixtures.find((f) => f.home === p.lineup || f.away === p.lineup) : undefined;
    if (!fixture?.kickoff || Date.parse(fixture.kickoff) <= args.now.getTime()) return { ...base, ...(profile ? { profile } : {}) };

    let matchup: SummaryPlayer["matchup"];
    if (profile) {
      const home = fixture.home === p.lineup;
      const opponent = home ? fixture.away : fixture.home;
      const opponentId = opponent && kbTeamOf.get(opponent.club.slug);
      const opponentForm = opponentId ? formBefore(history.matches, opponentId, fixture.kickoff) : undefined;
      // Without enough of the opponent's games there's no kind of match to compare with.
      const context = opponentForm && opponentForm.games >= MIN_FORM_GAMES ? { home, opponent: contextOf(opponentForm, !home) } : undefined;
      const mi = context && matchupIndex(profile, context);
      if (mi && context) matchup = { ...mi, context, opponentName: home ? fixture.awayName : fixture.homeName, ...(opponentForm ? { opponentForm } : {}), day: weekday(fixture.kickoff) };
    }
    const clubName = table.find((t) => t.id === p.kickbase.teamId)?.name;
    const rotation = clubName ? rotationRisk(hp, clubName, history.matches, args.cupGames, fixture.kickoff) : undefined;
    return { ...base, ...(profile ? { profile } : {}), ...(matchup ? { matchup } : {}), ...(rotation ? { rotation } : {}) };
  });

  return {
    now: args.now,
    firstKickoff: lineups.filter((l) => l.matchday === matchday && l.kickoff).map((l) => l.kickoff!).sort()[0],
    players,
    reliability: history ? reliabilityOnce(history, args.predictions, (slug) => kbTeamOf.get(slug)) : new Map(),
  };
}

function reliabilityOnce(history: KbHistory, predictions: SavedPrediction[], kbTeamOf: (slug: string) => string | undefined): Map<string, Reliability> {
  const cached = reliabilityCache.get(history);
  if (cached?.predictions === predictions) return cached.result;
  const result = reliabilityByClub(predictions, history, kbTeamOf);
  reliabilityCache.set(history, { predictions, result });
  return result;
}
