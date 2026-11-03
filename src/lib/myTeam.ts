// Mein Team's data: the manager's Kickbase squad matched with LigaInsider, the odds and the matchday summary.
// The page (src/pages/mein-team.astro) renders it; /api/app/my-team/ serves it to the iOS app (appTeam).
import { clubTable, KickbaseAuthError, leagues as fetchLeagues, login, myEleven, squad as fetchSquad, teamRoster, type KbLeague, type KbLive, type KbPlayer, type KbTeam } from "./kickbase.ts";
import { articlePlayer, mapClubs, matchSquad, pitchLines, type MyPlayer, type StartStatus } from "./match.ts";
import { toFixtures } from "./fixtures.ts";
import { chancesFor } from "./odds.ts";
import { matchInsights, type PlayerInsight } from "./scorers.ts";
import { hasFreshNews, matchLine, newsByPlayer, POSITIONS, startLabel, type CardData, type CardNews } from "./card.ts";
import { confirmedClubs } from "./lineupNews.ts";
import { anyRunning } from "./livePoints.ts";
import { clearSession, KB_NAME_COOKIE, KB_USER_ID_COOKIE, LEAGUE_COOKIE, relogin, TOKEN_COOKIE, type CookieJar } from "./session.ts";
import { summaryInput } from "./summary/input.ts";
import { summaryView, type SummaryView } from "./summary/compose.ts";
import type { Snapshot } from "../../scraper/snapshot.ts";
import type { KbHistory } from "../../scraper/kbHistory.ts";

export type PlayerOutlook = PlayerInsight & { cleanSheet?: number; win?: number };

export type MyTeamData = {
  leagues: KbLeague[];
  league: KbLeague | undefined;
  players: MyPlayer[];
  starterCount: number;
  points: number | undefined;
  outlook: Map<string, PlayerOutlook>;
  cardNews: Map<string, CardNews[]>;
  summary?: SummaryView;
};

export type MyTeamResult = { data: MyTeamData; signedOut?: "none" | "expired"; error?: string };

const DAY = 86_400_000;

// Public Bundesliga data, identical for every user: cached per Worker isolate for a day (only if non-empty).
const g = globalThis as unknown as {
  __kbTable?: { at: number; teams: KbTeam[] };
  __kbRosters?: Map<string, { at: number; names: string[] }>;
};
const rosters = (g.__kbRosters ??= new Map());

const empty = (): MyTeamData => ({ leagues: [], league: undefined, players: [], starterCount: 0, points: undefined, outlook: new Map(), cardNews: new Map(), summary: undefined });

/**
 * Everything Mein Team shows for the signed-in manager. An expired token is renewed quietly from the encrypted
 * credentials; without any, `signedOut` says so (the session cookies are cleared then).
 */
export async function myTeamData(args: {
  cookies: CookieJar; key: string | undefined; fetch: typeof fetch;
  /** ?league= — an explicit choice, remembered in a cookie. */
  league: string | null;
  snapshot: () => Promise<Snapshot | undefined>;
  history: () => Promise<KbHistory | undefined>;
}): Promise<MyTeamResult> {
  const { cookies, key } = args;
  const fetchFn = args.fetch;
  const doLogin = (email: string, password: string) => login(fetchFn, email, password);

  async function load(token: string): Promise<MyTeamData> {
    // Needed whatever the league: asked for while Kickbase looks up the leagues.
    const table = !g.__kbTable || Date.now() - g.__kbTable.at > DAY
      ? clubTable(fetchFn, token).then((teams) => void (teams.length > 0 && (g.__kbTable = { at: Date.now(), teams })))
      : undefined;
    table?.catch(() => {}); // still thrown below; this only covers the early returns
    const snapshotLoad = args.snapshot();
    const historyLoad = args.history();
    const leagues = await fetchLeagues(fetchFn, token);
    const picked = args.league;
    const wanted = picked ?? cookies.get(LEAGUE_COOKIE)?.value;
    const league = leagues.find((l) => l.id === wanted) ?? leagues[0];
    if (!league) return { ...empty(), leagues };
    // Only an explicit choice is remembered (not prefetches or defaults).
    if (picked && league.id === picked) {
      cookies.set(LEAGUE_COOKIE, league.id, { path: "/", secure: true, sameSite: "lax", maxAge: 60 * 60 * 24 * 400 });
    }
    // The manager's own XI and bench; if Kickbase can't deliver it, fall back to the plain squad list.
    const eleven = (token: string, id: string): Promise<{ starters: KbPlayer[]; bench: KbPlayer[]; points?: number }> =>
      myEleven(fetchFn, token, id).catch((err) => {
        if (err instanceof KickbaseAuthError) throw err;
        return fetchSquad(fetchFn, token, id).then((all) => ({ starters: [], bench: all }));
      });
    const [{ starters, bench, points }, snapshot, , history] = await Promise.all([eleven(token, league.id), snapshotLoad, table, historyLoad]);
    const squad = [...starters, ...bench];
    const teamIds = [...new Set(squad.map((p) => p.teamId))];
    await Promise.all(
      teamIds
        .filter((id) => !rosters.get(id) || Date.now() - rosters.get(id)!.at > DAY)
        .map((id) =>
          teamRoster(fetchFn, token, id)
            .then((names) => void (names.length > 0 && rosters.set(id, { at: Date.now(), names })))
            .catch(() => undefined),
        ),
    );
    const rosterMap = new Map(teamIds.flatMap((id) => (rosters.get(id) ? [[id, rosters.get(id)!.names] as const] : [])));
    // Starters of a confirmed XI (LigaInsider's "Aufstellung von …" before kickoff) are certain.
    const confirmed = confirmedClubs(snapshot?.articles ?? [], snapshot?.lineups ?? []);
    const players = matchSquad(squad, mapClubs(g.__kbTable?.teams ?? [], snapshot?.lineups ?? []), rosterMap).map((p) =>
      p.lineup && confirmed.has(p.lineup.club.id) && (p.status === "start" || p.status === "contested" || p.status === "doubtful")
        ? { ...p, status: "confirmed" as const, statusLabel: undefined, rival: undefined }
        : p,
    );
    // Odds-based outlook per Kickbase player id; the clean sheet is the player's team's.
    const fixtures = toFixtures(snapshot?.lineups ?? []);
    const insights = new Map<object, ReturnType<typeof matchInsights>>();
    const outlook = new Map<string, PlayerOutlook>();
    for (const p of players) {
      const fixture = p.lineup && fixtures.find((f) => f.home === p.lineup || f.away === p.lineup);
      if (!fixture) continue;
      if (!insights.has(fixture)) insights.set(fixture, matchInsights(fixture, snapshot?.state.odds, snapshot?.state.scorers));
      const mi = insights.get(fixture);
      if (!mi) continue;
      const chances = chancesFor(fixture, snapshot?.state.odds);
      outlook.set(p.kickbase.id, {
        ...(p.ligainsider ? mi.player(p.ligainsider) : {}),
        cleanSheet: fixture.home === p.lineup ? mi.cleanSheet.home : mi.cleanSheet.away,
        win: chances && (fixture.home === p.lineup ? chances.home : chances.away),
      });
    }
    const byNewest = [...(snapshot?.articles ?? [])].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
    const playerNews = newsByPlayer(byNewest);
    const cardNews = new Map(players.flatMap((p) => {
      // Players outside the predicted lineup have no LigaInsider id from it; their club's news names them.
      const list = playerNews(articlePlayer(p, byNewest)?.id);
      return list ? [[p.kickbase.id, list] as const] : [];
    }));
    // The summary above the lineup; whatever goes wrong there must not cost the page.
    let summary: SummaryView | undefined;
    try {
      summary = summaryView(summaryInput({
        now: new Date(), players, history, lineups: snapshot?.lineups ?? [], table: g.__kbTable?.teams ?? [],
        predictions: snapshot?.state.predictions ?? [], cupGames: snapshot?.state.cupGames ?? [], outlook, odds: snapshot?.state.odds,
        // The eleven he set in Kickbase (none set: the whole squad counts).
        ...(starters.length ? { lineupIds: new Set(starters.map((p) => p.id)) } : {}),
      }));
    } catch (err) {
      console.error("team summary", err);
    }
    return { leagues, league, players, starterCount: starters.length, points, outlook, cardNews, summary };
  }

  try {
    // Expired cookie → quietly log in again with the encrypted credentials (if the user has them).
    let token = cookies.get(TOKEN_COOKIE)?.value ?? (await relogin(cookies, key, doLogin));
    if (!token) return { data: empty(), signedOut: "none" };
    try {
      return { data: await load(token) };
    } catch (err) {
      if (!(err instanceof KickbaseAuthError)) throw err;
      token = await relogin(cookies, key, doLogin);
      if (token) return { data: await load(token) };
      clearSession(cookies);
      return { data: empty(), signedOut: "expired" };
    }
  } catch (err) {
    if (err instanceof KickbaseAuthError) {
      clearSession(cookies);
      return { data: empty(), signedOut: "expired" };
    }
    return { data: empty(), error: "Kickbase ist gerade nicht erreichbar. Versuch es gleich nochmal." };
  }
}

/** A player's card (status, next match, odds, news), as the page and the app show it. */
export function cardFor(p: MyPlayer, data: Pick<MyTeamData, "outlook" | "cardNews">): CardData {
  const start = startLabel(p.status, p.statusLabel, p.rival);
  return {
    id: p.ligainsider?.id,
    name: p.ligainsider?.name ?? p.kickbase.name,
    photo: p.ligainsider?.photo ?? p.kickbase.image,
    crest: p.club?.crest,
    pos: POSITIONS[p.kickbase.position] || undefined,
    match: matchLine(p.lineup),
    status: start.text,
    tone: start.tone,
    href: p.club ? `/vereine/${p.club.slug}/` : undefined,
    ...data.outlook.get(p.kickbase.id),
    news: data.cardNews.get(p.kickbase.id),
  };
}

/** The short note under a player on Mein Team's pitch (MyPitch.astro): will he start? */
export function pitchNote(p: MyPlayer): string | undefined {
  if (p.status === "contested" && p.rival) return `Alt: ${p.rival}`;
  if (p.status === "doubtful" && p.statusLabel) return p.statusLabel;
  return ({ doubtful: "Fraglich", alternative: "Alternative", bench: "Bank" } as Partial<Record<StartStatus, string>>)[p.status];
}

export type AppPlayer = {
  id: string; name: string; position: number; image?: string; live?: KbLive; card: CardData; freshNews: boolean;
  status: StartStatus; note?: string; rival?: string;
};

/** Mein Team for the iOS app: the page's view of the data, as JSON (players by Kickbase id). */
export type AppTeam = {
  signedOut?: "none" | "expired";
  error?: string;
  leagues: KbLeague[];
  leagueId?: string;
  points?: number;
  /** One of the XI's matches has started: the points are shown. */
  started: boolean;
  /** A match is running: the live points are worth polling. */
  running: boolean;
  formation: string;
  /** The XI on the pitch, goalkeeper line first (Kickbase ids). */
  lines: string[][];
  /** Everyone else; with no lineup set, the whole squad. */
  bench: string[];
  players: Record<string, AppPlayer>;
  summary?: SummaryView;
  /** From the readable session cookies, which the app can't read itself. */
  account?: { name?: string; userId?: string };
};

export function appTeam(result: MyTeamResult, cookies: CookieJar, now: number): AppTeam {
  const { leagues, league, players, starterCount, points, summary } = result.data;
  const xi = players.slice(0, starterCount);
  const pitch = pitchLines(xi);
  const name = cookies.get(KB_NAME_COOKIE)?.value;
  const userId = cookies.get(KB_USER_ID_COOKIE)?.value;
  return {
    ...(result.signedOut ? { signedOut: result.signedOut } : {}),
    ...(result.error ? { error: result.error } : {}),
    leagues,
    ...(league ? { leagueId: league.id } : {}),
    ...(points !== undefined ? { points } : {}),
    started: xi.some((p) => p.kickbase.live?.state),
    running: anyRunning(players.map((p) => p.kickbase.live), now),
    formation: pitch.formation,
    lines: pitch.lines.map((l) => l.map((p) => p.kickbase.id)),
    bench: players.slice(starterCount).map((p) => p.kickbase.id),
    players: Object.fromEntries(players.map((p) => [p.kickbase.id, {
      id: p.kickbase.id, name: p.kickbase.name, position: p.kickbase.position,
      ...(p.kickbase.image ? { image: p.kickbase.image } : {}),
      ...(p.kickbase.live ? { live: p.kickbase.live } : {}),
      card: cardFor(p, result.data),
      freshNews: hasFreshNews(result.data.cardNews.get(p.kickbase.id), now),
      status: p.status,
      ...(pitchNote(p) ? { note: pitchNote(p) } : {}),
      ...(p.rival ? { rival: p.rival } : {}),
    }])),
    ...(summary ? { summary } : {}),
    ...(name || userId ? { account: { ...(name ? { name } : {}), ...(userId ? { userId } : {}) } } : {}),
  };
}
