import * as cheerio from "cheerio";
import type { Article, ArticleRef, Category } from "../types.ts";
import { cleanText, parseClubHref, parseGermanDateTime, parsePlayerHref } from "../text.ts";
import { sanitizeBody } from "../sanitize.ts";

/** Slugs that look like players in URLs but are editorial accounts. */
const NON_PLAYER_SLUGS = new Set(["ligainsider"]);

export function parseArticle(html: string, ref: ArticleRef, category: Category, now: Date): Article {
  const $ = cheerio.load(html);
  const titleBox = $(".news_title_box").first();

  let player: Article["player"];
  let club: Article["club"];
  titleBox.find("strong a").each((_, a) => {
    const href = $(a).attr("href") ?? "";
    const name = cleanText($(a).text());
    const p = parsePlayerHref(href);
    if (p && !NON_PLAYER_SLUGS.has(p.slug) && !player) { player = { ...p, name }; return; }
    const c = parseClubHref(href);
    if (c && !club) club = { ...c, name };
  });

  const headline = cleanText($("h1[itemprop=name]").first().text()) || cleanText(titleBox.find("h2").text()) || ref.headline;
  const info = $(".news_banner_info").first();
  const publishedAt = parseGermanDateTime(info.find("span.float-start").first().text()) ?? "";
  const authorText = cleanText(info.find(".autor_melder").text());
  const author = authorText.match(/Autor:\s*(.+)$/)?.[1]?.trim()
    ?? authorText.match(/Gemeldet von:\s*(.+?)(\||$)/)?.[1]?.trim();

  const sourceLink = $(".quelle a").first();
  const sourceHref = sourceLink.attr("href") ?? "";
  const source = sourceLink.length
    ? { name: cleanText(sourceLink.text()), url: /^https?:\/\//i.test(sourceHref) ? sourceHref : undefined }
    : undefined;

  const bodyHtml = sanitizeBody($("[itemprop=articleBody]").first().html() ?? "");
  // LigaInsider's image service renders the banner at 2000 px (≈1.6 MB); 1200 px is plenty here (≈160 KB).
  // The photographer credit is part of the image and stays.
  const bannerSrc = $(".news_banner img.fullimage").first().attr("src");
  const banner = bannerSrc ? bannerSrc.replace(/\/tr:w-\d+,q-\d+/, "/tr:w-1200,q-80") : null;

  return {
    id: ref.id,
    url: ref.url,
    headline,
    listHeadline: ref.headline,
    category,
    newsType: ref.newsType,
    player,
    club,
    author: author || undefined,
    source,
    publishedAt,
    bodyHtml,
    banner,
    fetchedAt: now.toISOString(),
  };
}
