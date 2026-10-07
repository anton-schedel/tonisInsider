import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { createFetcher } from "./fetch.ts";
import { Store } from "./store.ts";
import { run } from "./run.ts";
import { restoreFromSite, writeSnapshot } from "./snapshot.ts";

const ROOT = process.cwd();
const store = new Store(join(ROOT, "store"));
const publicDir = join(ROOT, "public");

/** Writes key=value for later GitHub Actions steps (no-op locally). */
function output(key: string, value: string | number | boolean): void {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
}

const command = process.argv[2];

if (command === "scrape") {
  const result = await run({ store, fetcher: createFetcher(), publicDir, now: new Date() });
  console.log(`changed=${result.changed} new=${result.newArticles} lineups=${result.lineupsUpdated}`);
  for (const p of result.problems) console.warn(`PROBLEM: ${p}`);
  output("changed", result.changed);
  output("save_cache", result.changed || result.lineupsChecked);
  output("problems", result.problems.length);
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
  console.log("wrote public/data/snapshot.json");
} else {
  console.error("usage: tsx scraper/cli.ts <scrape|restore|snapshot>");
  process.exit(2);
}
