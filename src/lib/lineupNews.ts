import type { Article, Lineup } from "../../scraper/types.ts";

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

const HOUR = 3600_000;

/**
 * Clubs whose XI for their next match is confirmed: LigaInsider posted their "Aufstellung von …" in the hours
 * before that match's kickoff (or during it). Older posts belong to earlier matches.
 */
export function confirmedClubs(
  articles: Pick<Article, "url" | "bodyHtml" | "club" | "publishedAt">[],
  lineups: Pick<Lineup, "club" | "kickoff">[],
): Set<number> {
  const kickoff = new Map(lineups.flatMap((l) => (l.kickoff ? [[l.club.id, Date.parse(l.kickoff)] as const] : [])));
  const out = new Set<number>();
  for (const a of articles) {
    const k = a.club && kickoff.get(a.club.id);
    if (!k || !confirmedLineup(a)) continue;
    const t = Date.parse(a.publishedAt);
    if (t >= k - 6 * HOUR && t <= k + 3 * HOUR) out.add(a.club!.id);
  }
  return out;
}
