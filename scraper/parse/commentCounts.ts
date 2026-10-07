/**
 * Comment counts from a LigaInsider news overview: article id → count.
 * Regex instead of a DOM parser so the Worker can run it cheaply on the full overview page.
 */
export function parseCommentCounts(html: string): Record<number, number> {
  const counts: Record<number, number> = {};
  for (const m of html.matchAll(/<a\b[^>]*\bsmall_comment_top\b[^>]*>([\s\S]*?)<\/a>/g)) {
    const id = /href="[^"]*-(\d+)\/#comments"/.exec(m[0])?.[1];
    const count = /<small>\s*(\d+)\s*<\/small>/.exec(m[1])?.[1];
    if (id && count) counts[Number(id)] = Number(count);
  }
  return counts;
}
