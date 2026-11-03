import type { Article, Lineup, State } from "../../scraper/types.ts";
import type { Chances } from "../../scraper/odds.ts";
import { toFixtures } from "./fixtures.ts";
import { chancesFor, likelyScore } from "./odds.ts";
import { matchInsights, type PlayerInsight } from "./scorers.ts";
import { confirmedClubs } from "./lineupNews.ts";

/** A match of the coming matchday as the lineups page shows it (FixtureCard), worked out like the site does. */
export type AppFixture = {
  /** Club slugs (missing: the opponent has no lineup page). */
  home?: string;
  away?: string;
  homeName: string;
  awayName: string;
  kickoff?: string;
  matchday?: number;
  chances?: Chances;
  /** The most likely score from the odds ("Tipp 2:0"). */
  tip?: { home: number; away: number };
  /** Each team's chance to keep a clean sheet, in whole percent. */
  cleanSheet?: { home: number; away: number };
};

/**
 * The iOS app's news feed (/data/app-feed.json): everything the site builds its News, article and lineup pages
 * from, our own and the coach's posts included, so the app keeps it on the phone and renders it natively.
 * Posts built in before their minute come along; the app shows them from then on, like the site's ArticleRow.
 * What needs the odds model (chances, likely score, player odds) comes worked out, so it can't differ from the site.
 */
export type AppFeed = {
  version: 1;
  generatedAt: string;
  /** Newest first. */
  articles: Article[];
  /** Ids of the posts pinned on top, in order. */
  pinned: number[];
  lineups: Lineup[];
  fixtures: AppFixture[];
  /** Odds per LigaInsider player id (starters and alternatives on the pitches), for the player card. */
  insights: Record<string, PlayerInsight>;
  /** Clubs whose XI LigaInsider confirmed for the coming match. */
  confirmed: number[];
  commentCounts: Record<string, number>;
  odds?: State["odds"];
};

export function appFeed(input: { articles: Article[]; pinned: Article[]; lineups: Lineup[]; state: State; now: Date }): AppFeed {
  const { lineups, state } = input;
  const insights: Record<string, PlayerInsight> = {};
  const fixtures = toFixtures(lineups).map((f): AppFixture => {
    const chances = chancesFor(f, state.odds);
    const mi = matchInsights(f, state.odds, state.scorers);
    for (const l of [f.home, f.away]) {
      for (const p of l?.lines.flat() ?? []) {
        for (const who of [p, ...(p.alternative ? [p.alternative] : [])]) {
          const insight = mi?.player(who);
          if (insight && Object.keys(insight).length) insights[who.id] = insight;
        }
      }
    }
    const tip = chances && likelyScore(chances);
    return {
      ...(f.home ? { home: f.home.club.slug } : {}),
      ...(f.away ? { away: f.away.club.slug } : {}),
      homeName: f.homeName,
      awayName: f.awayName,
      ...(f.kickoff ? { kickoff: f.kickoff } : {}),
      ...((f.home ?? f.away)?.matchday !== undefined ? { matchday: (f.home ?? f.away)!.matchday } : {}),
      ...(chances ? { chances } : {}),
      ...(tip ? { tip: { home: tip.home, away: tip.away } } : {}),
      ...(mi ? { cleanSheet: mi.cleanSheet } : {}),
    };
  });
  return {
    version: 1,
    generatedAt: input.now.toISOString(),
    articles: input.articles,
    pinned: input.pinned.map((a) => a.id),
    lineups,
    fixtures,
    insights,
    confirmed: [...confirmedClubs(input.articles, lineups)],
    commentCounts: state.commentCounts ?? {},
    ...(state.odds ? { odds: state.odds } : {}),
  };
}
