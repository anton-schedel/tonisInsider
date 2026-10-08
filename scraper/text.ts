export const BASE_URL = "https://www.ligainsider.de";

/** Collapse whitespace and remove soft hyphens (&shy;). */
export function cleanText(s: string): string {
  return s.replace(/­/g, "").replace(/\s+/g, " ").trim();
}

/** "/gregor-kobel_9357/" → { slug: "gregor-kobel", id: 9357 } */
export function parsePlayerHref(href: string): { slug: string; id: number } | undefined {
  const m = href.match(/^\/([a-z0-9-]+)_(\d+)\/$/i);
  return m ? { slug: m[1], id: Number(m[2]) } : undefined;
}

/** "/borussia-dortmund/14/" → { slug: "borussia-dortmund", id: 14 } */
export function parseClubHref(href: string): { slug: string; id: number } | undefined {
  const m = href.match(/^\/([a-z0-9-]+)\/(\d+)\/$/i);
  return m ? { slug: m[1], id: Number(m[2]) } : undefined;
}

/** "/gregor-kobel_9357/kobel-kann-...-418778/" → 418778 */
export function parseArticleId(href: string): number | undefined {
  const m = href.match(/^\/[a-z0-9-]+_\d+\/[a-z0-9-]+-(\d+)\/$/i)
    ?? href.match(/^\/[a-z0-9-]+\/\d+\/[a-z0-9-]+-(\d+)\/$/i);
  return m ? Number(m[1]) : undefined;
}

/** UTC offset of Europe/Berlin at the given instant, in minutes (60 or 120). */
function berlinOffsetMinutes(utc: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Berlin", hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(utc);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  return Math.round((asUtc - utc.getTime()) / 60000);
}

/** Berlin wall-clock time → ISO string in UTC. */
export function berlinToIso(year: number, month: number, day: number, hour: number, minute: number): string {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const offset = berlinOffsetMinutes(new Date(guess.getTime() - 60 * 60000));
  return new Date(guess.getTime() - offset * 60000).toISOString();
}

/** Finds "DD.MM.YYYY" followed by "HH:MM" anywhere in the text, e.g. "07.10.2026 - 09:32 Uhr" or "Fr. 09.10.2026 | 20:30". */
export function parseGermanDateTime(text: string, now?: Date): string | undefined {
  const m = text.match(/(\d{2})\.(\d{2})\.(\d{4})\D{1,10}?(\d{2}):(\d{2})/);
  if (m) {
    const [, d, mo, y, h, mi] = m.map(Number);
    return berlinToIso(y, mo, d, h, mi);
  }
  // Close matches are written relative to today: "Heimspiel Morgen 20:30 gegen …".
  const rel = now && text.match(/(Übermorgen|Morgen|Heute)\D{1,10}?(\d{2}):(\d{2})/i);
  if (!rel || !now) return undefined;
  const days = { heute: 0, morgen: 1, übermorgen: 2 }[rel[1].toLowerCase() as "heute" | "morgen" | "übermorgen"];
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return berlinToIso(get("year"), get("month"), get("day") + days, Number(rel[2]), Number(rel[3]));
}

export function absoluteUrl(href: string): string {
  return new URL(href, BASE_URL).toString();
}
