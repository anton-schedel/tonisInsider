import type { Cheerio, CheerioAPI } from "cheerio";
import type { Element } from "domhandler";
import type { RatedPlayer, RatedSpot, RatingMark, TeamRatings } from "../types.ts";
import { cleanText, parsePlayerHref } from "../text.ts";

/** "3,43" / "4,5" → 3.43 / 4.5 (LigaInsider writes the decimals in a <small>). */
function grade(text: string): number | undefined {
  const m = /(\d)\s*,\s*(\d+)/.exec(cleanText(text));
  return m ? Number(`${m[1]}.${m[2]}`) : undefined;
}

/** LigaInsider's icon titles → what happened. Unknown icons are left out. */
function mark(title: string): RatingMark | undefined {
  const t = title.toLowerCase();
  if (t.includes("eigentor")) return "ownGoal";
  if (t === "tor" || t.startsWith("tor ")) return "goal";
  if (t.includes("vorlage")) return "assist";
  if (/gelb\s*-?\s*rot/.test(t)) return "yellowRed";
  if (t.includes("gelb")) return "yellow";
  if (/\brot/.test(t)) return "red";
  if (t.includes("fehler")) return "error";
  return undefined;
}

function player($: CheerioAPI, box: Cheerio<Element>): RatedPlayer | undefined {
  const link = box.find(".player_name a").first();
  const ref = parsePlayerHref(link.attr("href") ?? "");
  if (!ref) return undefined;
  // Goals and assists beside the grade, cards beside the name.
  const marks = box.find(".goal_and_boots_icon img, .player_name img").toArray()
    .flatMap((img) => mark($(img).attr("title") ?? $(img).attr("alt") ?? "") ?? []);
  return {
    ...ref,
    name: cleanText(link.text()),
    photoUrl: box.find(".player_position_photo img").first().attr("src") || undefined,
    grade: grade(box.find(".tags_info").first().text()),
    marks,
  };
}

/**
 * The grade blocks of a match report ("Aufstellung von …" with the XI on a pitch), one per team. A substitute
 * shares the spot of the player he replaced; the minute of the change is on the replaced player.
 */
export function parseRatings($: CheerioAPI, body: Cheerio<Element>): TeamRatings[] {
  return body.find(".stadium_container_small").toArray().flatMap((block, index) => {
    const b = $(block);
    const team = cleanText(b.find("h3").first().text()).replace(/^Aufstellung\s+(von|vom|der|des)\s+/i, "");
    // Both teams' averages head every block: ours is the side whose crest names our team.
    const sides = b.find(".team_title_holder > div").toArray().map((side) => ({
      name: cleanText($(side).children("img").first().attr("alt") ?? ""),
      crestUrl: $(side).children("img").first().attr("src") || undefined,
      average: grade($(side).find(".team_info_box span").first().text()),
    }));
    const side = sides.find((s) => s.name && (s.name.includes(team) || team.includes(s.name))) ?? sides[index];
    const lines = b.find(".player_position_row").toArray().map((row) =>
      $(row).children(".player_position_column").toArray().flatMap((col): RatedSpot[] => {
        const subs = $(col).children(".sub_child");
        if (!subs.length) {
          const p = player($, $(col));
          return p ? [{ player: p }] : [];
        }
        const p = player($, subs.eq(0));
        if (!p) return [];
        const sub = subs.length > 1 ? player($, subs.eq(1)) : undefined;
        const minute = Number.parseInt(cleanText(subs.eq(0).find(".player_no span").first().text()), 10);
        return [{ player: p, ...(sub ? { sub } : {}), ...(Number.isFinite(minute) ? { minute } : {}) }];
      }),
    ).filter((line) => line.length);
    if (!team || !lines.length) return [];
    return [{ team: side?.name || team, crestUrl: side?.crestUrl, average: side?.average, lines }];
  });
}
