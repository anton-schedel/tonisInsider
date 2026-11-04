// The minute check for new LigaInsider articles (Worker cron, src/worker.ts): only the overview's newest article
// id, found by a plain text search (a Worker on the free plan has ~10 ms of CPU, not enough to parse the page).
// A newer one than the site has starts the scrape run right away instead of at the next 5-minute slot.
import { USER_AGENT } from "../../scraper/fetch.ts";
import { COUNTS_URL } from "./comments.ts";

/** Article links end in "-<id>/" ("/gregor-kobel_9357/kobel-kann-…-418778/"). */
const ARTICLE_HREF = /href="[^"]*-(\d{6,9})\/"/g;

/** The newest article id on LigaInsider's news overview. */
export function newestListed(html: string): number | undefined {
  let newest: number | undefined;
  for (const m of html.matchAll(ARTICLE_HREF)) {
    const id = Number(m[1]);
    if (newest === undefined || id > newest) newest = id;
  }
  return newest;
}

/** A run is worth starting: LigaInsider lists a newer article than the site has, and none was started for it yet. */
export function newsWaiting(listed: number | undefined, ours: number | undefined, started: number | undefined): boolean {
  if (listed === undefined || ours === undefined) return false;
  return listed > ours && listed !== started;
}

/** LigaInsider's overview, or undefined when it can't be read (then the 5-minute run catches up). */
export async function fetchOverview(fetchFn: typeof fetch): Promise<string | undefined> {
  try {
    const res = await fetchFn(COUNTS_URL, { headers: { "user-agent": USER_AGENT, "accept-language": "de-DE,de;q=0.9" } });
    return res.ok ? await res.text() : undefined;
  } catch {
    return undefined;
  }
}
