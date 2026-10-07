import * as cheerio from "cheerio";
import type { Cheerio } from "cheerio";
import type { Element } from "domhandler";
import type { ClubRef, Lineup, LineupPlayer, Ref } from "../types.ts";
import { cleanText, parseGermanDateTime, parsePlayerHref } from "../text.ts";

type PlayerBits = Ref & { photoUrl?: string; statusLabel?: string };

function readPlayer(box: Cheerio<Element>): PlayerBits | undefined {
  const link = box.find(".player_name a").first();
  const ref = parsePlayerHref(link.attr("href") ?? "");
  if (!ref) return undefined;
  const statusLabel = box.find(".bottom_icon img[alt]").first().attr("alt")?.trim();
  return {
    ...ref,
    name: cleanText(link.text()),
    photoUrl: box.find(".player_position_photo img").first().attr("src") || undefined,
    statusLabel: statusLabel || undefined,
  };
}

/** Parses the predicted XI ("Voraussichtliche Aufstellung") from a club page. */
export function parseClubPage(html: string, club: ClubRef, now: Date): Lineup {
  const $ = cheerio.load(html);
  const lines: LineupPlayer[][] = [];

  $(".stadium_container_bg .player_position_row").each((_, row) => {
    const line: LineupPlayer[] = [];
    $(row).children(".player_position_column").each((_, col) => {
      const subs = $(col).children(".sub_child");
      const main = readPlayer(subs.length ? subs.eq(0) : $(col));
      if (!main) return;
      const alt = subs.length > 1 ? readPlayer(subs.eq(1)) : undefined;
      line.push({
        id: main.id, slug: main.slug, name: main.name,
        photoUrl: main.photoUrl,
        status: main.statusLabel ? "doubtful" : "set",
        statusLabel: main.statusLabel,
        alternative: alt ? { id: alt.id, slug: alt.slug, name: alt.name, photoUrl: alt.photoUrl } : undefined,
      });
    });
    if (line.length) lines.push(line);
  });

  const matchText = cleanText($(".team_box_right p").first().text());
  const opponentName = cleanText($(".team_box_right p strong").first().text());
  const matchdayText = cleanText($("select.day_select option[selected]").first().text());
  const matchday = Number(matchdayText.replace(/\D/g, "")) || undefined;

  return {
    club: { id: club.id, slug: club.slug, name: cleanText($("h2[itemprop=name]").first().text()) || club.name },
    opponent: opponentName ? { name: opponentName, home: /Heimspiel/i.test(matchText) } : undefined,
    matchday,
    kickoff: parseGermanDateTime(matchText),
    formation: lines.slice(1).map((l) => l.length).join("-"),
    lines,
    updatedAt: now.toISOString(),
  };
}
