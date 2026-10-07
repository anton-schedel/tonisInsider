import type { Article, Lineup, LineupPlayer, Ref } from "../../scraper/types.ts";
import type { KbPlayer, KbTeam } from "./kickbase.ts";

export type StartStatus = "start" | "doubtful" | "alternative" | "bench" | "unknown";

export type MyPlayer = {
  kickbase: KbPlayer;
  club?: Lineup["club"];
  lineup?: Lineup;
  ligainsider?: Ref & { photo?: string };
  status: StartStatus;
  statusLabel?: string;
};

/** Lowercase, strip accents, ß → ss, keep only a–z, 0–9 and single spaces. */
export function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Kickbase short names that are not contained in LigaInsider's full club name. Keys are normalised. */
const CLUB_ALIASES: Record<string, string> = {
  "m gladbach": "borussia-moenchengladbach",
  hamburg: "hamburger-sv",
  hsv: "hamburger-sv",
};

function containsWords(haystack: string, needle: string): boolean {
  return ` ${haystack} `.includes(` ${needle} `);
}

/** Kickbase team id → LigaInsider lineup (via club). Teams that map to zero or several clubs are left out. */
export function mapClubs(table: KbTeam[], lineups: Lineup[]): Map<string, Lineup> {
  const map = new Map<string, Lineup>();
  for (const team of table) {
    const key = normalize(team.name);
    const alias = CLUB_ALIASES[key];
    const hits = alias
      ? lineups.filter((l) => l.club.slug === alias)
      : lineups.filter((l) => containsWords(normalize(l.club.name), key));
    if (hits.length === 1) map.set(team.id, hits[0]);
  }
  return map;
}

function lastWord(s: string): string {
  return s.split(" ").pop() ?? "";
}

/** Surname-based: never matches a first name ("Can" must not match "can-uzun"). */
function nameMatches(kickbaseName: string, candidate: Ref): boolean {
  const kb = normalize(kickbaseName);
  const name = normalize(candidate.name);
  if (kb === name || kb === lastWord(name)) return true;
  return ` ${candidate.slug.split("-").join(" ")}`.endsWith(` ${kb}`);
}

/**
 * Matches one Kickbase player against a club's predicted lineup and derives the start status.
 * `roster` (all Kickbase names at that club) guards against same-surname teammates outside the lineup.
 */
export function matchPlayer(p: KbPlayer, lineup: Lineup | undefined, roster?: string[]): MyPlayer {
  if (!lineup) return { kickbase: p, status: "unknown" };
  const surname = lastWord(normalize(p.name));
  if (roster && roster.filter((n) => lastWord(normalize(n)) === surname).length > 1) {
    return { kickbase: p, club: lineup.club, lineup, status: "unknown" };
  }
  const starters: LineupPlayer[] = lineup.lines.flat();
  const alternatives = starters.flatMap((s) => (s.alternative ? [s.alternative] : []));
  const starterHits = starters.filter((s) => nameMatches(p.name, s));
  const altHits = alternatives.filter((a) => nameMatches(p.name, a));
  const base = { kickbase: p, club: lineup.club, lineup };
  if (starterHits.length + altHits.length > 1) return { ...base, status: "unknown" };
  const s = starterHits[0];
  if (s) {
    return {
      ...base,
      ligainsider: { id: s.id, slug: s.slug, name: s.name, photo: s.photo },
      status: s.status === "doubtful" ? "doubtful" : "start",
      statusLabel: s.statusLabel,
    };
  }
  const a = altHits[0];
  if (a) return { ...base, ligainsider: { id: a.id, slug: a.slug, name: a.name, photo: a.photo }, status: "alternative" };
  return { ...base, status: "bench" };
}

export function matchSquad(squad: KbPlayer[], clubs: Map<string, Lineup>, rosters?: Map<string, string[]>): MyPlayer[] {
  return squad.map((p) => matchPlayer(p, clubs.get(p.teamId), rosters?.get(p.teamId)));
}

/** Articles about the squad: by matched LigaInsider id, or by name at the same club. Newest first. */
export function squadNews(players: MyPlayer[], articles: Article[]): Article[] {
  const ids = new Set(players.flatMap((p) => (p.ligainsider ? [p.ligainsider.id] : [])));
  const byClub = new Map<number, string[]>();
  for (const p of players) {
    if (!p.club) continue;
    byClub.set(p.club.id, [...(byClub.get(p.club.id) ?? []), normalize(p.kickbase.name)]);
  }
  return articles
    .filter((a) => {
      if (!a.player) return false;
      if (ids.has(a.player.id)) return true;
      const names = a.club ? byClub.get(a.club.id) : undefined;
      if (!names) return false;
      const full = normalize(a.player.name);
      return names.some((n) => full === n || full.endsWith(` ${n}`));
    })
    .sort((x, y) => y.publishedAt.localeCompare(x.publishedAt));
}
