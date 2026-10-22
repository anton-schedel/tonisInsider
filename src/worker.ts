// Worker entry: Astro serves the site (fetch); a Cloudflare cron trigger (wrangler.jsonc) keeps it fresh.
import { handle } from "@astrojs/cloudflare/handler";
import { dispatchScrape } from "./lib/dispatch.ts";
import { runDueJobs } from "./lib/coachBotJob.ts";
import type { D1 } from "cloudflare:workers";

type Env = { GH_DISPATCH_TOKEN?: string; COMMENTS?: D1; MORPHEUS_API_KEY?: string; MORPHEUS_BASE_URL?: string; MORPHEUS_MODEL?: string };

export default {
  fetch: handle,
  async scheduled(_controller: unknown, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }) {
    ctx.waitUntil(
      dispatchScrape(fetch, env.GH_DISPATCH_TOKEN).catch((err: Error) => console.error(err.message)),
    );
    // Bot comments the coach's page didn't finish (closed too early): written here (a cron may run 15 minutes).
    if (env.COMMENTS) {
      const cfg = env.MORPHEUS_API_KEY && env.MORPHEUS_BASE_URL && env.MORPHEUS_MODEL
        ? { url: env.MORPHEUS_BASE_URL, key: env.MORPHEUS_API_KEY, model: env.MORPHEUS_MODEL } : undefined;
      ctx.waitUntil(runDueJobs(env.COMMENTS, cfg).catch((err: Error) => console.error(`coach bots: ${err.message}`)));
    }
  },
};
