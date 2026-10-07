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

/** Parses a LigaInsider news overview page (startpage or testspiele-news). */
export function parseNewsList(html: string): ArticleRef[] {
  const $ = cheerio.load(html);
  const refs: ArticleRef[] = [];
  const seen = new Set<number>();
  $(".feature_column").each((_, el) => {
    const col = $(el);
    const link = col.find("a.newsboxlink").first();
    const href = link.attr("href");
    if (!href) return;
    const id = parseArticleId(href);
    if (id === undefined || seen.has(id)) return;
    seen.add(id);
    const photo = col.find(".player_photo img").first().attr("src");
    refs.push({
      id,
      url: absoluteUrl(href),
      headline: cleanText(link.find("h3").text()),
      newsType: newsTypeFromLabel(col.find(".social_left_icon img").first().attr("alt")),
      playerPhotoUrl: photo || undefined,
    });
  });
  return refs;
}
