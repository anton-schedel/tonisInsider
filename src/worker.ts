// Worker entry: Astro serves the site (fetch); a Cloudflare cron trigger (wrangler.jsonc) keeps it fresh.
import { handle } from "@astrojs/cloudflare/handler";
import { dispatchScrape } from "./lib/dispatch.ts";
import { runDueJobs } from "./lib/coachBotJob.ts";
import { modelFromEnv } from "./lib/coachBots.ts";
import { fromCookieResponse, isAppRequest, toCookieRequest } from "./lib/appSession.ts";
import { fetchOverview, newestListed, newsWaiting } from "./lib/newsWatch.ts";
import type { D1 } from "cloudflare:workers";

type Env = {
  GH_DISPATCH_TOKEN?: string; COMMENTS?: D1; CREDENTIALS_KEY?: string; ASSETS: { fetch(req: Request | string): Promise<Response> };
} & Parameters<typeof modelFromEnv>[0];

/** The run started for an article the site doesn't have yet (kept an hour, so a skipped article isn't retried every minute). */
const STARTED = "https://news-watch.internal/started";

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
    // LigaInsider has a new article, which starts the run right away.
    if (new Date(controller.scheduledTime).getUTCMinutes() % 5 !== 0) {
      ctx.waitUntil(watchNews(env).catch((err: Error) => console.error(`news watch: ${err.message}`)));
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

async function watchNews(env: Env): Promise<void> {
  const [html, version] = await Promise.all([
    fetchOverview(fetch),
    env.ASSETS.fetch("https://assets.local/data/version.json").then((r) => (r.ok ? (r.json() as Promise<{ newest?: number }>) : {})).catch(() => ({})),
  ]);
  if (!html) return;
  const listed = newestListed(html);
  const cache = (caches as unknown as { default: Cache }).default;
  const started = Number(await (await cache.match(STARTED))?.text()) || undefined;
  if (!newsWaiting(listed, (version as { newest?: number }).newest, started)) return;
  await dispatchScrape(fetch, env.GH_DISPATCH_TOKEN);
  await cache.put(STARTED, new Response(String(listed), { headers: { "cache-control": "max-age=3600" } }));
}
