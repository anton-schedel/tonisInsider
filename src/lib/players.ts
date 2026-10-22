import type { Lineup } from "../../scraper/types.ts";
import { articles, lineups, odds, scorers } from "./data.ts";
import { confirmedClubs } from "./lineupNews.ts";
import { matchLine, newsByPlayer, rowPosition, type CardData } from "./card.ts";
import { matchInsights } from "./scorers.ts";
import { chancesFor } from "./odds.ts";
import { toFixtures } from "./fixtures.ts";

/** One player of the league for the search and the scout list. */
export type PlayerEntry = {
  id: number;
  name: string;
  club: string;
  photo?: string;
  crest?: string;
  /** For sorting: predicted starters first, then alternatives, then the rest of the squad. */
  rank: 0 | 1 | 2;
  card: CardData;
};

/**
 * Every player in the clubs' squads, with the card the club page would show (status, match, odds, news).
 * Names are the squad's full names ("Waldemar Anton"), so a search finds first names too.
 */
export function allPlayers(): PlayerEntry[] {
  const all = lineups();
  const fixtures = toFixtures(all);
  const confirmed = confirmedClubs(articles(), all);
  const news = newsByPlayer(articles());
  const out = new Map<number, PlayerEntry>();

  for (const lineup of all) {
    const fixture = fixtures.find((f) => f.home === lineup || f.away === lineup);
    const home = fixture?.home === lineup;
    const insights = fixture ? matchInsights(fixture, odds(), scorers()) : undefined;
    const chances = fixture ? chancesFor(fixture, odds()) : undefined;
    const base = {
      crest: lineup.club.crest,
      match: matchLine(lineup),
      href: `/vereine/${lineup.club.slug}/`,
      cleanSheet: insights && (home ? insights.cleanSheet.home : insights.cleanSheet.away),
      win: chances && (home ? chances.home : chances.away),
    };
    const fullName = new Map((lineup.squad ?? []).map((p) => [p.id, p.name]));
    const add = (p: { id: number; slug: string; name: string; photo?: string }, rank: PlayerEntry["rank"], extra: Partial<CardData>) => {
      if (out.has(p.id)) return;
      const name = fullName.get(p.id) ?? p.name;
      out.set(p.id, {
        id: p.id, name, club: lineup.club.name, photo: p.photo, crest: lineup.club.crest, rank,
        card: { id: p.id, name, photo: p.photo, ...base, ...(rank < 2 ? insights?.player(p) : {}), ...extra, news: news(p.id) },
      });
    };

    const rows = lineup.lines.length;
    lineup.lines.forEach((line, i) => line.forEach((p) => {
      const pos = rowPosition(i, rows);
      add(p, 0, { pos, ...mainStatus(p, confirmed.has(lineup.club.id)) });
      if (p.alternative) add(p.alternative, 1, { pos, status: `Alternative zu ${p.name}`, tone: "yellow" });
    }));
    for (const p of lineup.squad ?? []) add(p, 2, { status: "Nicht in der Startelf", tone: "grey" });
  }
  return [...out.values()];
}

function mainStatus(p: Lineup["lines"][number][number], confirmed: boolean): Partial<CardData> {
  if (confirmed) return { status: "S11", tone: "green" };
  if (p.status === "doubtful") return { status: `Fraglich${p.statusLabel ? ` · ${p.statusLabel}` : ""}`, tone: "yellow" };
  if (p.alternative) return { status: `Startelf · Alt. ${p.alternative.name}`, tone: "green" };
  return { status: "Startelf", tone: "green" };
}

