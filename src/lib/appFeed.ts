import type { Article, Lineup, State } from "../../scraper/types.ts";

/**
 * The iOS app's news feed (/data/app-feed.json): everything the site builds its News, article and lineup pages
 * from, our own and the coach's posts included, so the app keeps it on the phone and renders it natively.
 * Posts built in before their minute come along; the app shows them from then on, like the site's ArticleRow.
 */
export type AppFeed = {
  version: 1;
  generatedAt: string;
  /** Newest first. */
  articles: Article[];
  /** Ids of the posts pinned on top, in order. */
  pinned: number[];
  lineups: Lineup[];
  commentCounts: Record<string, number>;
  odds?: State["odds"];
  scorers?: State["scorers"];
};

export function appFeed(input: { articles: Article[]; pinned: Article[]; lineups: Lineup[]; state: State; now: Date }): AppFeed {
  return {
    version: 1,
    generatedAt: input.now.toISOString(),
    articles: input.articles,
    pinned: input.pinned.map((a) => a.id),
    lineups: input.lineups,
    commentCounts: input.state.commentCounts ?? {},
    ...(input.state.odds ? { odds: input.state.odds } : {}),
    ...(input.state.scorers ? { scorers: input.state.scorers } : {}),
  };
}
