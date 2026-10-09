import * as cheerio from "cheerio";
import type { ArticleRef, NewsType } from "../types.ts";
import { absoluteUrl, cleanText, parseArticleId } from "../text.ts";

const NEWS_TYPES: Record<string, NewsType> = {
  "verletzung": "verletzung",
  "angeschlagen": "angeschlagen",
  "aufbautraining": "aufbautraining",
  "fit": "fit",
};

export function newsTypeFromLabel(label: string | undefined): NewsType {
  const key = (label ?? "").trim().toLowerCase();
  return NEWS_TYPES[key] ?? "sonstiges";
}

/** "Vor 46 Min." → 46, "Vor 2 Std." → 120; anything else ("Gestern", a date) → undefined. */
export function minutesAgo(text: string): number | undefined {
  const m = /Vor\s+(\d+)\s+(Min|Std)/i.exec(text);
  if (!m) return undefined;
  return Number(m[1]) * (m[2].toLowerCase() === "std" ? 60 : 1);
}

/** Parses a LigaInsider news overview page (startpage or testspiele-news). */
export function parseNewsList(html: string): ArticleRef[] {
  const $ = cheerio.load(html);
  const refs: ArticleRef[] = [];
  const seen = new Set<number>();
  $(".feature_column").each((_, el) => {
    const col = $(el);
    // Confirmed lineups ("Aufstellung von <Club>", club URL) have no news box link, the XI as heading instead.
    const lineup = col.find("h3.vanews a").first();
    const link = lineup.length ? lineup : col.find("a.newsboxlink").first();
    const href = link.attr("href");
    if (!href) return;
    const id = parseArticleId(href);
    if (id === undefined || seen.has(id)) return;
    seen.add(id);
    const photoImg = col.find(".player_photo img").first();
    // Lineups show the club crest, not a player.
    const photo = lineup.length ? undefined : photoImg.attr("src");
    const photoName = lineup.length ? "" : cleanText(photoImg.attr("alt") ?? "");
    refs.push({
      id,
      url: absoluteUrl(href),
      headline: lineup.length ? cleanText(col.find("a.profile_link_box").first().text()) : cleanText(link.find("h3").text()),
      newsType: newsTypeFromLabel(col.find(".social_left_icon img").first().attr("alt")),
      playerPhotoUrl: photo || undefined,
      ...(photoName ? { playerName: photoName } : {}),
      listedAgoMinutes: minutesAgo(col.find("small.float-start").first().text()),
    });
  });
  return refs;
}
