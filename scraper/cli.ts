import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { createFetcher } from "./fetch.ts";
import { Store } from "./store.ts";
import { run } from "./run.ts";
import { lastingProblems } from "./problems.ts";
import { restoreFromSite, writeSnapshot, writeVersion } from "./snapshot.ts";

const ROOT = process.cwd();
const store = new Store(join(ROOT, "store"));
const publicDir = join(ROOT, "public");

/** Writes key=value for later GitHub Actions steps (no-op locally). */
function output(key: string, value: string | number | boolean): void {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
}

const command = process.argv[2];

if (command === "scrape") {
  const result = await run({
    store, fetcher: createFetcher(), publicDir, now: new Date(), codeVersion: process.env.GITHUB_SHA,
    oddsApiKey: process.env.ODDS_API_KEY || undefined,
  });
  console.log(`changed=${result.changed} new=${result.newArticles} lineups=${result.lineupsUpdated}`);
  // Only problems that last fail the run (GitHub emails); one-off glitches are just logged.
  const state = store.state();
  const { report, streaks } = lastingProblems(result.problems, state.problemStreaks ?? {});
  const streaksChanged = JSON.stringify(streaks) !== JSON.stringify(state.problemStreaks ?? {});
  if (streaksChanged) store.putState({ ...state, problemStreaks: streaks });
  for (const p of result.problems) console.warn(`${report.includes(p) ? "PROBLEM" : "glitch (reported if it lasts 3 runs)"}: ${p}`);
  output("changed", result.changed);
  output("save_cache", result.changed || result.stateChanged || streaksChanged);
  output("problems", report.length);
} else if (command === "restore") {
  if (store.articles().length > 0) {
    console.log("store already populated, nothing to restore");
  } else if (process.env.SITE_URL) {
    const ok = await restoreFromSite(store, createFetcher({ delayMs: 50 }), process.env.SITE_URL, publicDir);
    console.log(ok ? `restored ${store.articles().length} articles from site` : "starting fresh");
  } else {
    console.log("SITE_URL not set, starting fresh");
  }
} else if (command === "snapshot") {
  writeSnapshot(store, join(publicDir, "data", "snapshot.json"));
  writeVersion(store, join(publicDir, "data", "version.json"));
  console.log("wrote public/data/snapshot.json and version.json");
} else {
  console.error("usage: tsx scraper/cli.ts <scrape|restore|snapshot>");
  process.exit(2);
}
