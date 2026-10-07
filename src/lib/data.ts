import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Article, Lineup, State } from "../../scraper/types.ts";
import { dayKey } from "./format.ts";

const STORE = join(process.cwd(), "store");

function readDir<T>(dir: string): T[] {
  const path = join(STORE, dir);
  if (!existsSync(path)) return [];
  return readdirSync(path)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(path, f), "utf8")) as T);
}

let cache: { articles: Article[]; lineups: Lineup[]; state: State } | undefined;

function load() {
  if (!cache) {
    const statePath = join(STORE, "state.json");
    cache = {
      articles: readDir<Article>("articles").sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)),
      lineups: readDir<Lineup>("lineups").sort((a, b) => a.club.name.localeCompare(b.club.name, "de")),
      state: existsSync(statePath) ? (JSON.parse(readFileSync(statePath, "utf8")) as State) : {},
    };
  }
  return cache;
}

/** Newest first. Only Bundesliga news (older "Testspiele" articles in the store are hidden until they expire). */
export function articles(): Article[] {
  return load().articles.filter((a) => a.category === "bundesliga");
}

export function clubArticles(clubId: number): Article[] {
  return load().articles.filter((a) => a.club?.id === clubId);
}

/** Alphabetical by club name. */
export function lineups(): Lineup[] {
  return load().lineups;
}

/** LigaInsider comment count as of the last scrape (the news page refreshes the newest ones live). */
export function commentCount(articleId: number): number | undefined {
  return load().state.commentCounts?.[articleId];
}

/** Win chances from bookmaker odds, if an ODDS_API_KEY is configured. */
export function odds() {
  return load().state.odds;
}

export function lastUpdate(): string | undefined {
  return load().state.lastChangeAt;
}

/** Groups articles (already sorted newest first) into consecutive Berlin calendar days. */
export function groupByDay(list: Article[]): { day: string; first: string; items: Article[] }[] {
  const groups: { day: string; first: string; items: Article[] }[] = [];
  for (const a of list) {
    const day = dayKey(a.publishedAt);
    const last = groups[groups.length - 1];
    if (last?.day === day) last.items.push(a);
    else groups.push({ day, first: a.publishedAt, items: [a] });
  }
  return groups;
}
