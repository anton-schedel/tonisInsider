import type { Article, NewsType } from "../../scraper/types.ts";
import { NEWS_TYPE } from "./newsTypes.ts";

/**
 * Posts the TuS Schnöselmob coach writes on /schnoeselmob/ (stored in D1, built with the site like the
 * hand-written ones in content/posts/).
 */
export type CoachType = "lineup" | "result" | "player";

export type CoachPostData = {
  headline: string;
  text?: string;
  /** Rows from the goalkeeper forward, then the bench. */
  lineup?: { lines: string[][]; bench: string[] };
  result?: { opponent: string; ours: number; theirs: number; home: boolean };
  player?: { name: string; newsType: NewsType };
  bots?: { on: boolean; context?: string; mood?: BotMood };
  /**
   * The round picture in the feed (player news), cut in the editor: imageId the 256 px square, source the photo it
   * was cut from (the article photo or one of its own), x/y the cut's centre in that photo (0..1), zoom 1..4.
   * preset: not cut but the player's team-photo avatar as it is (imageId the avatar, source his team photo).
   */
  thumb?: CoachThumb;
};

export type CoachThumb = { imageId: string; source: string; x: number; y: number; zoom: number; preset?: boolean };

/** How the bot commenters feel about a post (the coach picks it). */
export const BOT_MOODS = { gemischt: "gemischt", froehlich: "fröhlich", frech: "frech", wuetend: "wütend", traurig: "traurig" } as const;
export type BotMood = keyof typeof BOT_MOODS;

export type CoachImage = { id: string; width: number; height: number };

export type CoachPost = {
  id: number;
  type: CoachType;
  data: CoachPostData;
  publishedAt: string;
  pinnedUntil?: string;
  image?: CoachImage;
  updatedAt: string;
};

/** Above the hand-written own posts (9000000xx), inside isOwnPost's range. */
export const COACH_ID_MIN = 900_001_000;

export const CLUB = { id: 0, slug: "tus-schnoeselmob", name: "TuS Schnöselmob", crest: "/brand/schnoeselmob.png" };
export const CLUB_BANNER = "/img/custom/schnoeselmob-banner.jpg";
/**
 * A scheduled post is built this long before its time (the scrape runs every 5 minutes) and shown from its minute
 * on. Not earlier: a post days ahead would sit in the page (and its day in the feed) before it's out.
 */
export const COACH_LEAD_MS = 15 * 60_000;
export const dueCoach = <T extends { publishedAt: string }>(posts: T[], now: Date) =>
  posts.filter((p) => Date.parse(p.publishedAt) <= now.getTime() + COACH_LEAD_MS);

export const imagePath = (id: string) => `/img/custom/coach/${id}.jpg`;

export const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export const slug = (s: string) =>
  s.toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
    .slice(0, 80).replace(/-+$/, "");

/** The coach's text: paragraphs at blank lines, single line breaks kept. */
const paragraphs = (text = "") =>
  text.trim().split(/\n\s*\n/).filter((p) => p.trim()).map((p) => `<p>${escapeHtml(p.trim()).replace(/\n/g, "<br>\n")}</p>`);

/** The article's text as the site builds it (also the editor's preview). */
export function coachBody(p: Pick<CoachPost, "type" | "data">): string {
  const d = p.data;
  const parts: string[] = [];
  if (p.type === "lineup" && d.lineup) {
    const xi = d.lineup.lines.map((l) => l.map(escapeHtml).join(", ")).join(" – ");
    const bench = d.lineup.bench.length ? `<br>\n<b>Bank: </b>${d.lineup.bench.map(escapeHtml).join(", ")}` : "";
    parts.push(`<p><b>Startelf: </b>${xi}${bench}</p>`);
  }
  if (p.type === "result" && d.result) {
    const r = d.result;
    const line = r.home ? `${CLUB.name} – ${escapeHtml(r.opponent)} ${r.ours}:${r.theirs}` : `${escapeHtml(r.opponent)} – ${CLUB.name} ${r.theirs}:${r.ours}`;
    parts.push(`<p><b>${line}</b></p>`);
  }
  parts.push(...paragraphs(d.text));
  return parts.join("\n");
}

export function toArticle(p: CoachPost): Article {
  const d = p.data;
  const path = p.type === "lineup" ? "aufstellung-des-tus-schnoeselmob" : slug(d.headline) || "beitrag";
  const photo = p.image ? imagePath(p.image.id) : undefined;
  // The feed's circle: the coach's cut if there is one (a tall photo centred shows the chest, not the head).
  const face = d.thumb ? imagePath(d.thumb.imageId) : photo;
  return {
    id: p.id,
    url: `/${CLUB.slug}/${path}-${p.id}/`,
    headline: d.headline,
    listHeadline: d.headline,
    category: "bundesliga",
    newsType: (p.type === "player" && d.player?.newsType) || "sonstiges",
    ...(p.type === "player" && d.player ? { player: { id: p.id, slug: slug(d.player.name), name: d.player.name, ...(face ? { photo: face } : {}) } } : {}),
    club: CLUB,
    source: { name: "TonInsider" },
    publishedAt: p.publishedAt,
    ...(p.pinnedUntil ? { pinnedUntil: p.pinnedUntil } : {}),
    bodyHtml: coachBody(p),
    banner: photo ?? CLUB_BANNER,
    ...(p.image ? { bannerSize: { width: p.image.width, height: p.image.height } } : {}),
    own: true,
    fetchedAt: p.updatedAt,
  };
}

export type CoachInput = { type: CoachType; data: CoachPostData; publishedAt: string; pinnedHours: number; imageId?: string };

const BAD = { error: "Ungültige Anfrage." };
const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const HEX16 = /^[0-9a-f]{16}$/;
const clamp = (v: number, lo: number, hi: number) => Math.round(Math.min(hi, Math.max(lo, v)) * 10_000) / 10_000;
const names = (v: unknown) => (Array.isArray(v) ? v.map((n) => str(n, 40)).filter(Boolean) : []);

/** What the editor sends, checked and cleaned. */
export function validate(raw: unknown, now: Date): CoachInput | { error: string } {
  if (!raw || typeof raw !== "object") return BAD;
  const r = raw as Record<string, unknown>;
  const type = r.type;
  if (type !== "lineup" && type !== "result" && type !== "player") return BAD;
  const d = (r.data && typeof r.data === "object" ? r.data : {}) as Record<string, unknown>;
  const headline = str(d.headline, 200);
  if (headline.length < 3 || headline.length > 140) return { error: "Die Überschrift braucht 3 bis 140 Zeichen." };
  const data: CoachPostData = { headline };
  const text = str(d.text, 5000);
  if (text) data.text = text;

  if (type === "lineup") {
    const l = (d.lineup ?? {}) as Record<string, unknown>;
    const lines = (Array.isArray(l.lines) ? l.lines : []).map(names).filter((row) => row.length);
    if (!lines.length) return { error: "Trag mindestens einen Spieler ein." };
    data.lineup = { lines, bench: names(l.bench) };
  } else if (type === "result") {
    const res = (d.result ?? {}) as Record<string, unknown>;
    const goals = [res.ours, res.theirs];
    if (!goals.every((g) => Number.isInteger(g) && (g as number) >= 0 && (g as number) <= 99)) return { error: "Das Ergebnis stimmt nicht." };
    const opponent = str(res.opponent, 60);
    if (!opponent) return { error: "Gegen wen wurde gespielt?" };
    data.result = { opponent, ours: res.ours as number, theirs: res.theirs as number, home: res.home !== false };
  } else {
    const pl = (d.player ?? {}) as Record<string, unknown>;
    if (typeof pl.newsType !== "string" || !(pl.newsType in NEWS_TYPE)) return BAD;
    const name = str(pl.name, 60);
    if (!name) return { error: "Welcher Spieler?" };
    data.player = { name, newsType: pl.newsType as NewsType };
  }

  const bots = (d.bots ?? {}) as Record<string, unknown>;
  if (typeof bots.on === "boolean") {
    const context = str(bots.context, 600);
    const mood = typeof bots.mood === "string" && bots.mood in BOT_MOODS ? (bots.mood as BotMood) : undefined;
    data.bots = { on: bots.on, ...(context ? { context } : {}), ...(mood ? { mood } : {}) };
  }

  // The feed picture (only player news shows one): dropped if broken, the feed then shows the article photo.
  const t = (d.thumb ?? {}) as Record<string, unknown>;
  const ids = [t.imageId, t.source].every((id) => typeof id === "string" && HEX16.test(id));
  if (type === "player" && ids && [t.x, t.y, t.zoom].every((n) => typeof n === "number" && Number.isFinite(n))) {
    data.thumb = { imageId: t.imageId as string, source: t.source as string, x: clamp(t.x as number, 0, 1), y: clamp(t.y as number, 0, 1), zoom: clamp(t.zoom as number, 1, 4), ...(t.preset === true ? { preset: true } : {}) };
  }

  const at = typeof r.publishedAt === "string" ? Date.parse(r.publishedAt) : NaN;
  if (Number.isNaN(at)) return { error: "Ungültige Zeit." };
  if (at > now.getTime() + 60 * 86_400_000) return { error: "Höchstens 60 Tage im Voraus." };
  const pinnedHours = r.pinnedHours ?? 0;
  if (typeof pinnedHours !== "number" || !(pinnedHours >= 0 && pinnedHours <= 24)) return { error: "Anheften geht für 0 bis 24 Stunden." };
  const imageId = typeof r.imageId === "string" && HEX16.test(r.imageId) ? r.imageId : undefined;
  return { type, data, publishedAt: new Date(at).toISOString(), pinnedHours, ...(imageId ? { imageId } : {}) };
}
