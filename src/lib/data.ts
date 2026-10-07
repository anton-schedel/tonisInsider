import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Article, Category, Lineup, State } from "../../scraper/types.ts";
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

/** Newest first, optionally filtered by category. */
export function articles(category?: Category): Article[] {
  const all = load().articles;
  return category ? all.filter((a) => a.category === category) : all;
}

export function clubArticles(clubId: number): Article[] {
  return load().articles.filter((a) => a.club?.id === clubId);
}

/** Alphabetical by club name. */
export function lineups(): Lineup[] {
  return load().lineups;
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
