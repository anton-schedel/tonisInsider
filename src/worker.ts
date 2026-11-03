// Worker entry: Astro serves the site (fetch); a Cloudflare cron trigger (wrangler.jsonc) keeps it fresh.
import { handle } from "@astrojs/cloudflare/handler";
import { dispatchScrape } from "./lib/dispatch.ts";
import { runDueJobs } from "./lib/coachBotJob.ts";
import { modelFromEnv } from "./lib/coachBots.ts";
import { fromCookieResponse, isAppRequest, toCookieRequest } from "./lib/appSession.ts";
import type { D1 } from "cloudflare:workers";

type Env = { GH_DISPATCH_TOKEN?: string; COMMENTS?: D1; CREDENTIALS_KEY?: string } & Parameters<typeof modelFromEnv>[0];

export default {
  // The iOS app's requests carry its session as a token (lib/appSession.ts); everything else as before.
  async fetch(request: Request, env: Env, ctx: Parameters<typeof handle>[2]) {
    if (!isAppRequest(request)) return handle(request, env as Parameters<typeof handle>[1], ctx);
    if (!env.CREDENTIALS_KEY) return Response.json({ error: "Nicht verfügbar." }, { status: 503 });
    const { request: adapted, jar } = await toCookieRequest(request, env.CREDENTIALS_KEY);
    return fromCookieResponse(await handle(adapted, env as Parameters<typeof handle>[1], ctx), jar, env.CREDENTIALS_KEY);
  },
  async scheduled(_controller: unknown, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }) {
    ctx.waitUntil(
      dispatchScrape(fetch, env.GH_DISPATCH_TOKEN).catch((err: Error) => console.error(err.message)),
    );
    // Bot comments the coach's page didn't finish (closed too early): written here (a cron may run 15 minutes).
    if (env.COMMENTS) {
      ctx.waitUntil(runDueJobs(env.COMMENTS, modelFromEnv(env)).catch((err: Error) => console.error(`coach bots: ${err.message}`)));
    }
  },
};
