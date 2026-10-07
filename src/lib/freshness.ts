import type { Version } from "../../scraper/snapshot.ts";

export type UpdateContext = {
  /** The page just became visible again after a while in the background. */
  resumed: boolean;
  /** Scrolled (almost) to the top, so replacing the content doesn't pull anything away. */
  nearTop: boolean;
  path: string;
};

/**
 * What an open page does when the site has been updated:
 * coming back to the app at the top → refresh quietly; a new article otherwise → show a notice;
 * anything else while reading → nothing (the next navigation loads fresh pages anyway).
 */
export function updateAction(page: Version, live: Version, ctx: UpdateContext): "none" | "notice" | "refresh" {
  if (!page.updated || !live.updated || page.updated === live.updated) return "none";
  const newNews = page.newest !== live.newest;
  if (ctx.resumed && ctx.nearTop && ctx.path !== "/mein-team/") return "refresh";
  return newNews ? "notice" : "none";
}
