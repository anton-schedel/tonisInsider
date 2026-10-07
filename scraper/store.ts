import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Article, Lineup, State } from "./types.ts";

/** File-based storage under one root directory (default: ./store). */
export class Store {
  constructor(readonly root: string) {
    mkdirSync(join(root, "articles"), { recursive: true });
    mkdirSync(join(root, "lineups"), { recursive: true });
  }

  private readJson<T>(path: string): T | undefined {
    return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : undefined;
  }

  private writeJson(path: string, value: unknown): void {
    writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
  }

  articles(): Article[] {
    return readdirSync(join(this.root, "articles"))
      .filter((f) => f.endsWith(".json"))
      .map((f) => this.readJson<Article>(join(this.root, "articles", f))!);
  }

  getArticle(id: number): Article | undefined {
    return this.readJson<Article>(join(this.root, "articles", `${id}.json`));
  }

  putArticle(a: Article): void {
    this.writeJson(join(this.root, "articles", `${a.id}.json`), a);
  }

  deleteArticle(id: number): void {
    rmSync(join(this.root, "articles", `${id}.json`), { force: true });
  }

  lineups(): Lineup[] {
    return readdirSync(join(this.root, "lineups"))
      .filter((f) => f.endsWith(".json"))
      .map((f) => this.readJson<Lineup>(join(this.root, "lineups", f))!);
  }

  getLineup(slug: string): Lineup | undefined {
    return this.readJson<Lineup>(join(this.root, "lineups", `${slug}.json`));
  }

  putLineup(l: Lineup): void {
    this.writeJson(join(this.root, "lineups", `${l.club.slug}.json`), l);
  }

  state(): State {
    return this.readJson<State>(join(this.root, "state.json")) ?? {};
  }

  putState(s: State): void {
    this.writeJson(join(this.root, "state.json"), s);
  }
}
