/**
 * The Bundesliga clubs' games in the Champions League, Europa League, Conference League and DFB-Pokal (The Odds API's
 * event lists, which cost no quota), for the rotation risk around them. The API only lists upcoming games, so
 * they're kept from the day we first see them on.
 */
export type CupGame = { id: string; competition: string; kickoff: string; home: string; away: string };

export const CUP_COMPETITIONS: Record<string, string> = {
  soccer_uefa_champs_league: "Champions League",
  soccer_uefa_europa_league: "Europa League",
  soccer_uefa_europa_conference_league: "Conference League",
  soccer_germany_dfb_pokal: "DFB-Pokal",
};

export const cupGamesUrl = (apiKey: string, sport: string) =>
  `https://api.the-odds-api.com/v4/sports/${sport}/events?apiKey=${encodeURIComponent(apiKey)}`;

const DAY = 24 * 3600_000;

export const cupGamesDue = (fetchedAt: string | undefined, now: Date) => !fetchedAt || now.getTime() - Date.parse(fetchedAt) >= DAY;

/** The games with a Bundesliga club, named as in the provider's Bundesliga odds ("Bayern Munich"). */
export function parseCupGames(json: unknown, competition: string, bundesliga: Set<string>): CupGame[] {
  if (!Array.isArray(json)) return [];
  return (json as { id?: string; commence_time?: string; home_team?: string; away_team?: string }[])
    .filter((e) => e.id && e.commence_time && e.home_team && e.away_team && (bundesliga.has(e.home_team) || bundesliga.has(e.away_team)))
    .map((e) => ({ id: e.id!, competition, kickoff: e.commence_time!, home: e.home_team!, away: e.away_team! }));
}

/** Known games stay; a game listed again takes its current kickoff. Oldest first. */
export function mergeCupGames(old: CupGame[] | undefined, fresh: CupGame[]): CupGame[] {
  const byId = new Map((old ?? []).map((g) => [g.id, g]));
  for (const g of fresh) byId.set(g.id, g);
  return [...byId.values()].sort((a, b) => a.kickoff.localeCompare(b.kickoff));
}
