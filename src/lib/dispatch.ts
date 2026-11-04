// Starts the scrape workflow on GitHub. Called by the Worker's Cloudflare cron trigger every 5 minutes (and at once
// when the minute check sees a new LigaInsider article),
// because GitHub's own scheduler is best-effort (late or skipped runs) and our news must be fresh.

export const WORKFLOW_DISPATCH_URL =
  "https://api.github.com/repos/anton-schedel/tonisInsider/actions/workflows/scrape.yml/dispatches";

/**
 * `token`: fine-grained GitHub token limited to this repo with "Actions: read and write".
 * force=false → the workflow only builds and deploys when the scraper found changes.
 */
export async function dispatchScrape(fetchFn: typeof fetch, token: string | undefined): Promise<void> {
  if (!token) return;
  const res = await fetchFn(WORKFLOW_DISPATCH_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "content-type": "application/json",
      "user-agent": "tonisinsider-cron",
      "x-github-api-version": "2022-11-28",
    },
    body: JSON.stringify({ ref: "main", inputs: { force: "false" } }),
  });
  if (!res.ok) throw new Error(`GitHub workflow dispatch failed: HTTP ${res.status}`);
}

/** The scrape workflow's latest runs (to hold back a start right after another one). */
export async function latestRuns(fetchFn: typeof fetch, token: string | undefined): Promise<{ status: string; created_at: string }[] | undefined> {
  if (!token) return undefined;
  const res = await fetchFn(WORKFLOW_DISPATCH_URL.replace(/dispatches$/, "runs?per_page=3"), {
    headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "user-agent": "tonisinsider-cron", "x-github-api-version": "2022-11-28" },
  });
  if (!res.ok) return undefined;
  return ((await res.json()) as { workflow_runs?: { status: string; created_at: string }[] }).workflow_runs ?? [];
}
