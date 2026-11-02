import { appendFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createFetcher } from "./fetch.ts";
import { Store } from "./store.ts";
import { run } from "./run.ts";
import { lastingProblems } from "./problems.ts";
import { restoreFromSite, writeSnapshot, writeVersion } from "./snapshot.ts";
import { coachDueIds, pullCoachPosts } from "./coach.ts";
import { historyDue, loadHistory, updateHistory, type KbHistory } from "./kbHistory.ts";
import { KickbaseAuthError, clubTable, login, performance, playerCenter, teamSquad } from "../src/lib/kickbase.ts";

const ROOT = process.cwd();
const store = new Store(join(ROOT, "store"));
const publicDir = join(ROOT, "public");

/** Ids of our own posts (content/posts/) whose time has come: a post scheduled for later is built only then. */
function ownPostsOut(now: Date): number[] {
  const dir = join(ROOT, "content", "posts");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as { id: number; publishedAt: string })
    .filter((p) => Date.parse(p.publishedAt) <= now.getTime())
    .map((p) => p.id)
    .sort((a, b) => a - b);
}

/** Writes key=value for later GitHub Actions steps (no-op locally). */
function output(key: string, value: string | number | boolean): void {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
}

const HISTORY_FILE = join(ROOT, "store", "kb-history.json");

/**
 * Kickbase's season history of every player (scraper/kbHistory.ts), with the owner's account (KICKBASE_EMAIL /
 * KICKBASE_PASSWORD; never logged). At most `budget` requests, a short pause between them; the rest next run.
 * Returns whether the history changed, or a problem to report.
 */
async function history(now: Date, budget: number): Promise<{ changed: boolean; problem?: string }> {
  const email = process.env.KICKBASE_EMAIL;
  const password = process.env.KICKBASE_PASSWORD;
  if (!email || !password) return { changed: false };
  const h = loadHistory(existsSync(HISTORY_FILE) ? readFileSync(HISTORY_FILE, "utf8") : undefined);
  if (!historyDue(h, now)) return { changed: false };
  const slow: typeof fetch = async (input, init) => {
    await new Promise((r) => setTimeout(r, 150));
    return fetch(input, init);
  };
  let changed = false;
  try {
    const { token } = await login(slow, email, password);
    const r = await updateHistory(h, {
      table: () => clubTable(slow, token),
      squad: (id) => teamSquad(slow, token, id),
      performance: (id) => performance(slow, token, id),
      events: async (id, matchId) => (await playerCenter(slow, token, id, matchId)).events,
    }, now, budget);
    changed = r.changed;
    console.log(`kickbase history: ${r.requests} requests, ${Object.keys(h.players).length} players, ${h.queue.length} queued`);
  } catch (err) {
    // Progress up to the error is kept below.
    changed = true;
    if (err instanceof KickbaseAuthError) return save(h, "kickbase history: login rejected, check KICKBASE_EMAIL / KICKBASE_PASSWORD");
    console.warn(`kickbase history unavailable (${(err as Error).message}), going on next run`);
  }
  return changed ? save(h) : { changed };

  function save(h: KbHistory, problem?: string) {
    writeFileSync(HISTORY_FILE, JSON.stringify(h));
    return { changed: true, ...(problem ? { problem } : {}) };
  }
}

const command = process.argv[2];

if (command === "scrape") {
  const now = new Date();
  const result = await run({
    store, fetcher: createFetcher(), publicDir, now, codeVersion: process.env.GITHUB_SHA,
    oddsApiKey: process.env.ODDS_API_KEY || undefined,
  });
  console.log(`changed=${result.changed} new=${result.newArticles} lineups=${result.lineupsUpdated}`);
  // Only problems that last fail the run (GitHub emails); one-off glitches are just logged.
  let state = store.state();
  // A scheduled own post is due: rebuild, so it appears (within one run, i.e. ~5 minutes).
  const out = ownPostsOut(now);
  const postsChanged = JSON.stringify(out) !== JSON.stringify(state.ownPostsOut ?? []);
  if (postsChanged) {
    state = { ...state, ownPostsOut: out };
    store.putState(state);
    result.changed = true;
  }
  // The coach's posts (/schnoeselmob/): a new, edited or deleted one rebuilds the site.
  if (process.env.COACH_EXPORT_URL && process.env.COACH_EXPORT_TOKEN) {
    const coach = await pullCoachPosts({
      site: process.env.COACH_EXPORT_URL, token: process.env.COACH_EXPORT_TOKEN,
      file: join(ROOT, "store", "coach-posts.json"), imgDir: join(publicDir, "img", "custom", "coach"),
      teamFile: join(ROOT, "store", "team-photos.json"),
    });
    if (coach.problem) result.problems.push(coach.problem);
    const file = join(ROOT, "store", "coach-posts.json");
    const due = existsSync(file) ? coachDueIds(JSON.parse(readFileSync(file, "utf8")), now) : [];
    const dueChanged = JSON.stringify(due) !== JSON.stringify(state.coachDue ?? []);
    if (coach.changed || dueChanged) {
      // Also a change for open pages (version.json's "updated").
      state = { ...state, coachDue: due, lastChangeAt: now.toISOString() };
      store.putState(state);
      result.changed = true;
    }
  }
  const hist = await history(now, 300);
  if (hist.problem) result.problems.push(hist.problem);
  const { report, streaks } = lastingProblems(result.problems, state.problemStreaks ?? {});
  const streaksChanged = JSON.stringify(streaks) !== JSON.stringify(state.problemStreaks ?? {});
  if (streaksChanged) store.putState({ ...state, problemStreaks: streaks });
  for (const p of result.problems) console.warn(`${report.includes(p) ? "PROBLEM" : "glitch (reported if it lasts 3 runs)"}: ${p}`);
  output("changed", result.changed);
  output("save_cache", result.changed || result.stateChanged || streaksChanged || postsChanged || hist.changed);
  output("problems", report.length);
} else if (command === "restore") {
  // The Kickbase history has its own file on the site: back it up even when the store itself survived.
  if (!existsSync(HISTORY_FILE) && process.env.SITE_URL) {
    const res = await fetch(`${process.env.SITE_URL.replace(/\/$/, "")}/data/kb-history.json`).catch(() => undefined);
    if (res?.ok) {
      mkdirSync(join(ROOT, "store"), { recursive: true });
      writeFileSync(HISTORY_FILE, await res.text());
      console.log("restored the Kickbase history from site");
    }
  }
  if (store.articles().length > 0) {
    console.log("store already populated, nothing to restore");
  } else if (process.env.SITE_URL) {
    const ok = await restoreFromSite(store, createFetcher({ delayMs: 50 }), process.env.SITE_URL, publicDir);
    console.log(ok ? `restored ${store.articles().length} articles from site` : "starting fresh");
  } else {
    console.log("SITE_URL not set, starting fresh");
  }
} else if (command === "history") {
  // The one-time backfill, run locally with the owner's account from .env: no request budget to speak of.
  const r = await history(new Date(), 10_000);
  console.log(r.problem ?? (r.changed ? "history updated" : "history already up to date"));
} else if (command === "snapshot") {
  writeSnapshot(store, join(publicDir, "data", "snapshot.json"));
  writeVersion(store, join(publicDir, "data", "version.json"));
  // Kept apart from the snapshot (it's large and only Mein Team reads it); restored from the site like it.
  if (existsSync(HISTORY_FILE)) {
    mkdirSync(join(publicDir, "data"), { recursive: true });
    copyFileSync(HISTORY_FILE, join(publicDir, "data", "kb-history.json"));
  }
  console.log("wrote public/data/snapshot.json and version.json");
} else {
  console.error("usage: tsx scraper/cli.ts <scrape|restore|snapshot|history>");
  process.exit(2);
}
