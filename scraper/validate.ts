import type { Article, Lineup } from "./types.ts";

/** Returns a list of problems; empty means the article is safe to publish. */
export function validateArticle(a: Article): string[] {
  const problems: string[] = [];
  if (!Number.isInteger(a.id) || a.id <= 0) problems.push("invalid id");
  if (!a.headline) problems.push("missing headline");
  if (!a.publishedAt || Number.isNaN(Date.parse(a.publishedAt))) problems.push("missing or invalid publishedAt");
  if (a.bodyHtml.replace(/<[^>]+>/g, "").trim().length < 20) problems.push("body too short");
  return problems;
}

/** Returns a list of problems; empty means the lineup is safe to publish. */
export function validateLineup(l: Lineup): string[] {
  const problems: string[] = [];
  const count = l.lines.reduce((n, line) => n + line.length, 0);
  if (count !== 11) problems.push(`expected 11 players, got ${count}`);
  if (l.lines[0]?.length !== 1) problems.push("first line must be exactly one goalkeeper");
  if (!l.club.name) problems.push("missing club name");
  return problems;
}
