import * as cheerio from "cheerio";
import type { ClubRef } from "../types.ts";
import { cleanText } from "../text.ts";

/** Finds the Bundesliga clubs via the homepage navigation (links to /<slug>/<id>/verein/news/). */
export function parseClubs(html: string): ClubRef[] {
  const $ = cheerio.load(html);
  const ids = new Map<number, string>();
  $("a[href]").each((_, a) => {
    const m = ($(a).attr("href") ?? "").match(/^\/([a-z0-9-]+)\/(\d+)\/verein\/news\/$/);
    if (m) ids.set(Number(m[2]), m[1]);
  });
  const clubs: ClubRef[] = [];
  for (const [id, slug] of ids) {
    const img = $(`a[href="/${slug}/${id}/"] img[alt]`).first();
    clubs.push({
      id,
      slug,
      name: cleanText(img.attr("alt") ?? slug),
      crestUrl: img.attr("src") ?? "",
    });
  }
  return clubs;
}
