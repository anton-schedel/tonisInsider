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

/** A run is worth starting: LigaInsider lists an article newer than the highest id the scraper knows (version.json seen). */
export function newsWaiting(listed: number | undefined, seen: number | undefined): boolean {
  return listed !== undefined && seen !== undefined && listed > seen;
}

/**
 * The brake: none while a run waits or runs or right after one started, and no more than 3 starts in 10 minutes
 * (the 5-minute slots make 2): one early run fits between the slots, and a check that goes wrong costs at most
 * one extra run per 10 minutes — never one per minute.
 */
const JUST_STARTED_MS = 90_000;
const WINDOW_MS = 10 * 60_000;
const MAX_IN_WINDOW = 3;
export type WorkflowRun = { status: string; created_at: string };

export function runRecently(runs: WorkflowRun[], now: number): boolean {
  const age = (r: WorkflowRun) => now - Date.parse(r.created_at);
  return runs.some((r) => r.status === "queued" || r.status === "in_progress" || r.status === "waiting" || age(r) < JUST_STARTED_MS)
    || runs.filter((r) => age(r) < WINDOW_MS).length >= MAX_IN_WINDOW;
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
