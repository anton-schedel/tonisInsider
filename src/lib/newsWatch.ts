// The minute check for new LigaInsider articles (Worker cron, src/worker.ts): only the overview's article ids,
// found by a plain text search (a Worker on the free plan has ~10 ms of CPU, not enough to parse the page).
// One the scraper hasn't seen there starts the scrape run right away instead of at the next 5-minute slot.
import { USER_AGENT } from "../../scraper/fetch.ts";
import { articleIdsIn } from "../../scraper/text.ts";
import { COUNTS_URL } from "./comments.ts";

/** The newest article id on LigaInsider's news overview. */
export function newestListed(html: string): number | undefined {
  const ids = articleIdsIn(html);
  return ids.length ? Math.max(...ids) : undefined;
}

/**
 * A run is worth starting: the overview links an article that wasn't on it at the scraper's last read
 * (version.json listed) — whatever its id, they come out of order. A site without `listed` yet: an id above the
 * highest the scraper knows (seen), as before.
 */
export function newsWaiting(html: string, version: { seen?: number; listed?: number[] }): boolean {
  const ids = articleIdsIn(html);
  if (version.listed?.length) {
    const had = new Set(version.listed);
    return ids.some((id) => !had.has(id));
  }
  return ids.length > 0 && version.seen !== undefined && Math.max(...ids) > version.seen;
}

/**
 * The brake: none while a run waits or runs or right after one started, and no more than 6 starts in 10 minutes
 * (the 5-minute slots make 2): four early runs fit in, so a burst of posts (press conferences) doesn't wait for the
 * slots, and a check that goes wrong costs at most four extra runs per 10 minutes — never one per minute.
 * It was 3 while the check compared only the highest id; it compares the whole list now (newsWaiting).
 */
const JUST_STARTED_MS = 90_000;
const WINDOW_MS = 10 * 60_000;
const MAX_IN_WINDOW = 6;
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
