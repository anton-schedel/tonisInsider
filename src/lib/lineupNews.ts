import type { Article } from "../../scraper/types.ts";

/** A confirmed lineup post ("Aufstellung von Borussia Dortmund"): its XI and bench as text, shown right in the feed. */
export function confirmedLineup(a: Pick<Article, "url" | "bodyHtml">): { xi: string; bench?: string } | undefined {
  if (!/\/aufstellung-vo[mn]-/.test(a.url)) return undefined;
  const text = a.bodyHtml
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
  const xi = /Startelf:\s*([^\n]+)/.exec(text)?.[1].trim();
  if (!xi) return undefined;
  const bench = /Bank:\s*([^\n]+)/.exec(text)?.[1].trim();
  return { xi, ...(bench ? { bench } : {}) };
}
