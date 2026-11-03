import { articles, lineups, pinnedArticles, state } from "../../lib/data.ts";
import { appFeed } from "../../lib/appFeed.ts";

/** The iOS app's feed (src/lib/appFeed.ts), written with each build like the pages. */
export function GET() {
  const now = new Date();
  return Response.json(appFeed({ articles: articles(), pinned: pinnedArticles(now), lineups: lineups(), state: state(), now }));
}
