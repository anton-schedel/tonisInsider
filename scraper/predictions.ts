import type { Article, Lineup } from "./types.ts";
import { confirmedLineup } from "../src/lib/lineupNews.ts";

/**
 * LigaInsider's predicted XI as a Kickbase manager last saw it: Kickbase locks the lineup at the matchday's first
 * kickoff, so every club's prediction is saved once, from 90 minutes before that kickoff (Friday 19:00 for a
 * 20:30 game). Later the confirmed XI is added, so the predictions' reliability per club can be measured.
 */
export type PredictedPlayer = { id: number; name: string; doubtful?: true; alternative?: { id: number; name: string } };
export type ClubPrediction = {
  kickoff?: string;
  opponent?: string;
  xi: PredictedPlayer[];
  /** LigaInsider's "Aufstellung von …" for this match: the XI as text ("Kobel – Ryerson, Anton, …"). */
  confirmed?: string;
};
export type SavedPrediction = { matchday: number; firstKickoff: string; savedAt: string; clubs: Record<string, ClubPrediction> };

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
export const SAVE_BEFORE_MIN = 90;

/** The matchday to save now: its first kickoff is at most 90 minutes away and it isn't saved yet. */
export function predictionDue(lineups: Lineup[], saved: SavedPrediction[], now: Date): { matchday: number; firstKickoff: string } | undefined {
  const first = new Map<number, string>();
  for (const l of lineups) {
    if (l.matchday === undefined || !l.kickoff) continue;
    const known = first.get(l.matchday);
    if (!known || l.kickoff < known) first.set(l.matchday, l.kickoff);
  }
  for (const [matchday, firstKickoff] of first) {
    const left = Date.parse(firstKickoff) - now.getTime();
    // The same matchday number comes round every season: saved means saved for this kickoff (within a week).
    const done = saved.some((p) => p.matchday === matchday && Math.abs(Date.parse(p.firstKickoff) - Date.parse(firstKickoff)) < 7 * 24 * HOUR);
    if (left > 0 && left <= SAVE_BEFORE_MIN * MINUTE && !done) return { matchday, firstKickoff };
  }
  return undefined;
}

export function snapshotPrediction(lineups: Lineup[], matchday: number, firstKickoff: string, now: Date): SavedPrediction {
  const clubs: Record<string, ClubPrediction> = {};
  for (const l of lineups) {
    const players = l.lines.flat();
    if (l.matchday !== matchday || !players.length) continue;
    clubs[l.club.slug] = {
      ...(l.kickoff ? { kickoff: l.kickoff } : {}),
      ...(l.opponent ? { opponent: l.opponent.name } : {}),
      xi: players.map((p) => ({
        id: p.id,
        name: p.name,
        ...(p.status === "doubtful" ? { doubtful: true as const } : {}),
        ...(p.alternative ? { alternative: { id: p.alternative.id, name: p.alternative.name } } : {}),
      })),
    };
  }
  return { matchday, firstKickoff, savedAt: now.toISOString(), clubs };
}

/** Fills in each saved club's confirmed XI from LigaInsider's lineup post for that match (posted ~1 h before kickoff). */
export function addConfirmed(saved: SavedPrediction[], articles: Pick<Article, "url" | "bodyHtml" | "club" | "publishedAt">[]): SavedPrediction[] {
  return saved.map((p) => {
    const clubs = { ...p.clubs };
    for (const [slug, c] of Object.entries(clubs)) {
      if (c.confirmed || !c.kickoff) continue;
      const kickoff = Date.parse(c.kickoff);
      const post = articles.find((a) => {
        const t = Date.parse(a.publishedAt);
        return a.club?.slug === slug && t >= kickoff - 6 * HOUR && t <= kickoff + 3 * HOUR && confirmedLineup(a);
      });
      const xi = post && confirmedLineup(post)?.xi;
      if (xi) clubs[slug] = { ...c, confirmed: xi };
    }
    return { ...p, clubs };
  });
}

/** One scrape run's part: save the due matchday, fill in confirmed lineups. */
export function recordPredictions(
  saved: SavedPrediction[] | undefined, lineups: Lineup[], articles: Pick<Article, "url" | "bodyHtml" | "club" | "publishedAt">[], now: Date,
): { predictions: SavedPrediction[]; changed: boolean } {
  const before = saved ?? [];
  const due = predictionDue(lineups, before, now);
  const predictions = addConfirmed(due ? [...before, snapshotPrediction(lineups, due.matchday, due.firstKickoff, now)] : before, articles);
  return { predictions, changed: JSON.stringify(predictions) !== JSON.stringify(before) };
}
