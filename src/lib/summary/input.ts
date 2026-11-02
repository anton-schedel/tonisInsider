import type { KbHistory } from "../../../scraper/kbHistory.ts";
import type { SavedPrediction } from "../../../scraper/predictions.ts";
import type { CupGame } from "../../../scraper/cupGames.ts";
import type { Lineup } from "../../../scraper/types.ts";
import type { KbTeam } from "../kickbase.ts";
import { mapClubs, type MyPlayer, type StartStatus } from "../match.ts";
import { toFixtures } from "../fixtures.ts";
import { contextOf, matchupIndex, MIN_FORM_GAMES, profileOf, venueIndex } from "./profile.ts";
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
  /** The page's odds per Kickbase player id: his club's win chance and clean sheet chance, in whole percent. */
  outlook?: Map<string, { win?: number; cleanSheet?: number }>;
}): SummaryInput {
  const { history, lineups, table } = args;
  const clubs = mapClubs(table, lineups);
  const kbTeamOf = new Map([...clubs].map(([kbId, l]) => [l.club.slug, kbId]));
  const fixtures = toFixtures(lineups);
  const matchday = currentMatchday(lineups);

  const nameOf = (kbId: string | undefined) => table.find((x) => x.id === kbId)?.name;

  const players = args.players.map((p): SummaryPlayer => {
    const base: SummaryPlayer = {
      name: p.kickbase.name,
      inPredictedXi: IN_XI.has(p.status),
      position: p.kickbase.position,
      ...(p.lineup ? { clubSlug: p.lineup.club.slug, clubName: p.lineup.club.name } : {}),
    };
    // Only this matchday's game, before it starts: a club whose page still shows last weekend says nothing.
    const fixture = p.lineup?.matchday === matchday ? fixtures.find((f) => f.home === p.lineup || f.away === p.lineup) : undefined;
    const upcoming = fixture?.kickoff && Date.parse(fixture.kickoff) > args.now.getTime() ? fixture : undefined;
    const home = upcoming?.home === p.lineup;
    const opponent = upcoming && (home ? upcoming.away : upcoming.home);
    const opponentId = opponent && kbTeamOf.get(opponent.club.slug);

    // This week's chances, from the odds the page has for its player cards.
    const chances = args.outlook?.get(p.kickbase.id);
    const outlook: SummaryPlayer["outlook"] = upcoming && chances?.win !== undefined ? {
      team: nameOf(p.kickbase.teamId) ?? p.lineup!.club.name,
      opponent: nameOf(opponentId) ?? (home ? upcoming.awayName : upcoming.homeName),
      home, win: chances.win, kickoff: upcoming.kickoff!,
      ...(p.lineup?.club.crest ? { crest: p.lineup.club.crest } : {}),
      ...(chances.cleanSheet !== undefined ? { cleanSheet: chances.cleanSheet } : {}),
    } : undefined;

    const hp = history?.players[p.kickbase.id];
    const profile = history && hp ? profileOf(hp, history.matches) : undefined;
    let matchup: SummaryPlayer["matchup"];
    let venue: SummaryPlayer["venue"];
    let rotation: SummaryPlayer["rotation"];
    if (history && hp && upcoming) {
      if (profile) {
        venue = venueIndex(profile, home);
        const opponentForm = opponentId ? formBefore(history.matches, opponentId, upcoming.kickoff!) : undefined;
        // Without enough of the opponent's games there's no kind of match to compare with.
        const context = opponentForm && opponentForm.games >= MIN_FORM_GAMES ? { home, opponent: contextOf(opponentForm, !home) } : undefined;
        const mi = context && matchupIndex(profile, context);
        if (mi && context) matchup = { ...mi, context, opponentName: home ? upcoming.awayName : upcoming.homeName, ...(opponentForm ? { opponentForm } : {}), day: weekday(upcoming.kickoff!) };
      }
      const clubName = nameOf(p.kickbase.teamId);
      rotation = clubName ? rotationRisk(hp, clubName, history.matches, args.cupGames, upcoming.kickoff!) : undefined;
    }
    return {
      ...base,
      ...(outlook ? { outlook } : {}),
      ...(profile ? { profile } : {}),
      ...(venue ? { venue } : {}),
      ...(matchup ? { matchup } : {}),
      ...(rotation ? { rotation } : {}),
    };
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
