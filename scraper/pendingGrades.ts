import type { Article } from "./types.ts";

/**
 * A grades heading of a match report with nothing under it yet: LigaInsider publishes the report right after the
 * final whistle with bare "Aufstellung von …" headings and fills in the grade pitches later. Only whitespace,
 * line breaks and empty headings may follow, up to the next such heading or the end (a lineup given as text after
 * the heading, as in some cup reports, means no grades will come).
 */
const HEADING = String.raw`<h3>\s*Aufstellung\s+(?:von|vom|der|des)\s[^<]*<\/h3>`;
const PENDING = String.raw`${HEADING}(?:\s|<br\s*\/?>|<h3>\s*<\/h3>)*(?=<h3>\s*Aufstellung\s+(?:von|vom|der|des)\s|$)`;

/** Some player (or one who came on) in the report's grade pitches has a grade. */
export function hasGrades(a: Pick<Article, "ratings">): boolean {
  return !!a.ratings?.some((team) => team.lines.flat().some((spot) => spot.player.grade !== undefined || spot.sub?.grade !== undefined));
}

/**
 * A match report whose grades aren't in yet: bare grade headings. (A pitch without a single grade is no sign: the
 * weekly LigaInsider-Topelf and friendlies have one for good; a re-read stores only grades, see run.ts.)
 */
export function pendingGrades(a: Pick<Article, "bodyHtml" | "ratings">): boolean {
  return !hasGrades(a) && new RegExp(PENDING).test(a.bodyHtml);
}

/** The body without the bare grade headings (readers don't see empty "Aufstellung von …" while the grades are out). */
export function withoutPendingHeadings(html: string): string {
  return html.replace(new RegExp(PENDING, "g"), "");
}
