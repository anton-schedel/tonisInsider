// Worker entry: Astro serves the site (fetch); a Cloudflare cron trigger (wrangler.jsonc) keeps it fresh.
import { handle } from "@astrojs/cloudflare/handler";
import { dispatchScrape, latestRuns } from "./lib/dispatch.ts";
import { runDueJobs } from "./lib/coachBotJob.ts";
import { modelFromEnv } from "./lib/coachBots.ts";
import { fromCookieResponse, isAppRequest, toCookieRequest } from "./lib/appSession.ts";
import { fetchOverview, newsWaiting, runRecently } from "./lib/newsWatch.ts";
import type { D1 } from "cloudflare:workers";

type Env = {
  GH_DISPATCH_TOKEN?: string; COMMENTS?: D1; CREDENTIALS_KEY?: string; ASSETS: { fetch(req: Request | string): Promise<Response> };
} & Parameters<typeof modelFromEnv>[0];


export default {
  // The iOS app's requests carry its session as a token (lib/appSession.ts); everything else as before.
  async fetch(request: Request, env: Env, ctx: Parameters<typeof handle>[2]) {
    if (!isAppRequest(request)) return handle(request, env as Parameters<typeof handle>[1], ctx);
    if (!env.CREDENTIALS_KEY) return Response.json({ error: "Nicht verfügbar." }, { status: 503 });
    const { request: adapted, jar } = await toCookieRequest(request, env.CREDENTIALS_KEY);
    return fromCookieResponse(await handle(adapted, env as Parameters<typeof handle>[1], ctx), jar, env.CREDENTIALS_KEY);
  },
  async scheduled(controller: { scheduledTime: number }, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }) {
    // Every minute (wrangler.jsonc): the full run every 5 minutes as before; in between only a look whether
    // LigaInsider has a new article, which starts the run right away — three looks a minute (WATCH_AT_MS).
    if (new Date(controller.scheduledTime).getUTCMinutes() % 5 !== 0) {
      ctx.waitUntil(watchNewsThroughMinute(env, controller.scheduledTime));
      return;
    }
    ctx.waitUntil(
      dispatchScrape(fetch, env.GH_DISPATCH_TOKEN).catch((err: Error) => console.error(err.message)),
    );
    // Bot comments the coach's page didn't finish (closed too early): written here (a cron may run 15 minutes).
    if (env.COMMENTS) {
      ctx.waitUntil(runDueJobs(env.COMMENTS, modelFromEnv(env)).catch((err: Error) => console.error(`coach bots: ${err.message}`)));
    }
  },
};

/** When in the minute the looks happen: a cron comes once a minute at best, so the two more wait in the same call. */
const WATCH_AT_MS = [0, 20_000, 40_000];

/** The minute's looks, until one starts a run. A look that fails doesn't stop the next. */
async function watchNewsThroughMinute(env: Env, scheduledTime: number): Promise<void> {
  for (const at of WATCH_AT_MS) {
    const wait = scheduledTime + at - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    const started = await watchNews(env).catch((err: Error) => (console.error(`news watch: ${err.message}`), false));
    if (started) return;
  }
}

type Seen = { seen?: number; listed?: number[] };

/** True when it started a run. */
async function watchNews(env: Env): Promise<boolean> {
  const [html, version] = await Promise.all([
    fetchOverview(fetch),
    env.ASSETS.fetch("https://assets.local/data/version.json")
      .then((r): Promise<Seen> => (r.ok ? (r.json() as Promise<Seen>) : Promise.resolve({})))
      .catch((): Seen => ({})),
  ]);
  if (!html || !newsWaiting(html, version)) return false;
  // Not while a run is on its way, and at most 3 starts in 10 minutes (lib/newsWatch.ts runRecently);
  // unknown (GitHub not reachable): no early start, the 5-minute run comes anyway.
  const runs = await latestRuns(fetch, env.GH_DISPATCH_TOKEN);
  if (!runs || runRecently(runs, Date.now())) return false;
  await dispatchScrape(fetch, env.GH_DISPATCH_TOKEN);
  return true;
}
