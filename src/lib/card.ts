import type { Article, Lineup, NewsType } from "../../scraper/types.ts";
import type { PlayerInsight } from "./scorers.ts";
import { kickoffDay, time } from "./format.ts";
import type { StartStatus } from "./match.ts";

/** What the player card (PlayerCard.astro) shows; serialised into the tapped element's data-card. */
export type CardData = PlayerInsight & {
  name: string;
  photo?: string;
  crest?: string;
  /** "vs Bayern · Sa. 15:30" */
  match?: string;
  /** Start status, e.g. "Fraglich · Knie". */
  status?: string;
  tone?: "green" | "yellow" | "grey";
  /** The player's team keeps a clean sheet. */
  cleanSheet?: number;
  /** The player's team wins. */
  win?: number;
  /** TW, ABW, MF or ST. */
  pos?: string;
  /** Club page link (Mein Team only; on the club page the player is already there). */
  href?: string;
  /** His latest news, newest first. */
  news?: CardNews[];
};
export type CardNews = { id: number; title: string; type: NewsType; at: string };

/** News this recent marks the player with a newspaper icon (NewsBadge.astro); older stays in the card only. */
export const FRESH_NEWS_MS = 3 * 86_400_000;
export const hasFreshNews = (news: CardNews[] | undefined, now = Date.now()) =>
  !!news?.length && now - Date.parse(news[0].at) < FRESH_NEWS_MS;

/** How many of a player's articles the card lists. */
export const CARD_NEWS = 3;

/** A player's latest articles for the card, by LigaInsider player id (articles newest first). */
export function newsByPlayer(articles: Pick<Article, "id" | "headline" | "newsType" | "publishedAt" | "player">[]) {
  const by = new Map<number, CardNews[]>();
  for (const a of articles) {
    if (!a.player) continue;
    const list = by.get(a.player.id) ?? [];
    if (list.length < CARD_NEWS) list.push({ id: a.id, title: a.headline, type: a.newsType, at: a.publishedAt });
    by.set(a.player.id, list);
  }
  return (playerId: number | undefined) => (playerId === undefined ? undefined : by.get(playerId));
}

/** The club's next match, seen from that club. */
export function matchLine(l: Lineup | undefined): string | undefined {
  if (!l?.opponent) return undefined;
  return `${l.opponent.home ? "vs" : "@"} ${l.opponent.name}${l.kickoff ? ` · ${kickoffDay(l.kickoff)} ${time(l.kickoff)}` : ""}`;
}

export const cardAttr = (data: CardData) => JSON.stringify(data);

const START: Record<StartStatus, { text: string; tone: NonNullable<CardData["tone"]> }> = {
  confirmed: { text: "S11", tone: "green" },
  start: { text: "Startelf", tone: "green" },
  contested: { text: "Startelf", tone: "yellow" },
  doubtful: { text: "Fraglich", tone: "yellow" },
  alternative: { text: "Alternative", tone: "yellow" },
  bench: { text: "Nicht in der Startelf", tone: "grey" },
  unknown: { text: "Unbekannt", tone: "grey" },
};

/** Start status of a Kickbase player per LigaInsider's lineup, as text and colour (StartBadge, player card). */
export function startLabel(status: StartStatus, label?: string, rival?: string) {
  const s = START[status];
  const text = `${s.text}${status === "doubtful" && label ? ` · ${label}` : ""}${status === "contested" && rival ? ` · Alt. ${rival}` : ""}`;
  return { text, tone: s.tone };
}

/** Position label from a Kickbase position (1 goalkeeper … 4 forward). */
export const POSITIONS = ["", "TW", "ABW", "MF", "ST"] as const;

/** Position label from the row of a lineup (0 goalkeeper, last row forwards). */
export function rowPosition(row: number, rows: number): string {
  return row === 0 ? "TW" : row === rows - 1 ? "ST" : row === 1 ? "ABW" : "MF";
}
