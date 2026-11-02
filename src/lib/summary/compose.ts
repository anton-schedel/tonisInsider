import { GROUP_LABEL } from "./groups.ts";
import type { Context, Profile } from "./profile.ts";
import type { Reliability } from "./reliability.ts";
import type { Rotation } from "./rotation.ts";
import type { Form } from "./teamForm.ts";

export type SummaryPlayer = {
  name: string;
  inPredictedXi: boolean;
  clubSlug?: string;
  /** LigaInsider's club name, for the sentences. */
  clubName?: string;
  profile?: Profile;
  matchup?: { index: number; games: number; context: Context; opponentName: string; opponentForm?: Form; day: string };
  rotation?: Rotation;
  /** Kickbase position (1 goalkeeper, 2 defender, 3 midfielder, 4 striker). */
  position?: number;
  /** This week's game: his club and the opponent (short names), kickoff, his club's crest, win and clean sheet chance in whole percent. */
  outlook?: { team: string; opponent: string; home: boolean; win: number; cleanSheet?: number; kickoff: string; crest?: string };
  /** His points at this week's venue against the other one (profile.ts venueIndex). */
  venue?: { index: number; games: number };
};

export type SummaryInput = { now: Date; firstKickoff?: string; players: SummaryPlayer[]; reliability: Map<string, Reliability> };

/** One game of his predicted starters this matchday: what TeamSummary.astro draws as a row. */
export type GameRow = {
  team: string; opponent: string; home: boolean; win: number; kickoff: string; crest?: string;
  /** note: "zu Hause stärker", "48 % zu Null". */
  players: { name: string; note?: string }[];
};
export type SummaryView = { inXi: number; total: number; games: GameRow[]; notes: string[] };

/** A matchup is named from 30 % off his average; a club's prediction is "often wrong" below 9 of 11. */
const STANDS_OUT = 0.3;
const OFTEN_WRONG = 9;
/** Clean sheet chance from which a goalkeeper or defender gets it as a note. */
const CLEAN_SHEET = 40;

/** Only before the matchday's first kickoff: from then on Kickbase has locked the lineup. */
export const summaryVisible = (now: Date, firstKickoff: string | undefined): boolean =>
  !!firstKickoff && now.getTime() < Date.parse(firstKickoff);

const list = (names: string[]) => (names.length > 1 ? `${names.slice(0, -1).join(", ")} und ${names.at(-1)}` : names[0]);
const weekday = (iso: string) => new Intl.DateTimeFormat("de-DE", { weekday: "long", timeZone: "Europe/Berlin" }).format(new Date(iso));
const OPPONENT = { strong: "formstarke", middle: "durchschnittliche", weak: "formschwache" } as const;

function howMuch(index: number): string {
  if (index <= 0.6) return "nur halb so viele Punkte wie sonst";
  if (index >= 1.8) return "doppelt so viele Punkte wie sonst";
  return index < 1 ? "deutlich weniger Punkte als sonst" : "deutlich mehr Punkte als sonst";
}

function matchupClause(p: SummaryPlayer): string {
  const m = p.matchup!;
  const where = m.context.home ? "zu Hause" : "auswärts";
  const top = p.profile ? `, die meisten aus ${GROUP_LABEL[p.profile.top]}` : "";
  const game = `${m.day} ${m.context.home ? "gegen" : "bei"} ${m.opponentName}`;
  const form = m.opponentForm ? `, Gegner mit ${m.opponentForm.momentum} Punkten aus den letzten ${m.opponentForm.last} Spielen` : "";
  return `${p.name} holt ${where} gegen ${OPPONENT[m.context.opponent]} Teams ${howMuch(m.index)}${top} (${game}${form})`;
}

const where = (home: boolean) => (home ? "zu Hause" : "auswärts");

/** "zu Hause stärker", "48 % zu Null": what stands out about him in this game. */
function noteOf(p: SummaryPlayer): string | undefined {
  const o = p.outlook!;
  const notes = [
    p.venue && Math.abs(p.venue.index - 1) >= STANDS_OUT ? `${where(o.home)} ${p.venue.index > 1 ? "stärker" : "schwächer"}` : undefined,
    (p.position === 1 || p.position === 2) && (o.cleanSheet ?? 0) >= CLEAN_SHEET ? `${o.cleanSheet} % zu Null` : undefined,
  ].filter(Boolean);
  return notes.length ? notes.join(", ") : undefined;
}

/** His predicted starters' games, one row each, the best win chance first. */
function gameRows(inXi: SummaryPlayer[]): GameRow[] {
  const rows = new Map<string, GameRow>();
  for (const p of inXi) {
    const o = p.outlook;
    if (!o) continue;
    const key = `${o.team}|${o.kickoff}`;
    if (!rows.has(key)) rows.set(key, { team: o.team, opponent: o.opponent, home: o.home, win: o.win, kickoff: o.kickoff, ...(o.crest ? { crest: o.crest } : {}), players: [] });
    const note = noteOf(p);
    rows.get(key)!.players.push({ name: p.name, ...(note ? { note } : {}) });
  }
  return [...rows.values()].sort((a, b) => b.win - a.win);
}

function competition(name: string): string {
  return name === "DFB-Pokal" ? "im DFB-Pokal" : `in der ${name}`;
}

export function summaryView(input: SummaryInput): SummaryView | undefined {
  if (!summaryVisible(input.now, input.firstKickoff)) return undefined;
  const { players, reliability } = input;
  const out: string[] = [];

  const inXi = players.filter((p) => p.inPredictedXi);

  const matchups = players
    .filter((p) => p.matchup && Math.abs(p.matchup.index - 1) >= STANDS_OUT)
    .sort((a, b) => Math.abs(b.matchup!.index - 1) - Math.abs(a.matchup!.index - 1))
    .slice(0, 3);
  if (matchups.length) out.push(`${matchups.map(matchupClause).join("; ")}.`);

  const rotating = players.filter((p) => p.rotation).slice(0, 3);
  if (rotating.length === 1) {
    const [p] = rotating;
    const r = p.rotation!;
    out.push(`Rotationsgefahr bei ${p.name}: ${p.clubName ?? "Sein Verein"} spielt am ${weekday(r.near.kickoff)} ${competition(r.near.competition)}, und neben solchen Spielen stand er zuletzt nur ${r.nearStarts} von ${r.nearGames} Mal in der Startelf.`);
  } else if (rotating.length) {
    out.push(`Rotationsgefahr bei ${list(rotating.map((p) => p.name))}: Neben Europapokal- und Pokalspielen standen sie zuletzt deutlich seltener in der Startelf, und diese Woche steht wieder eins an.`);
  }

  const clubs = [...new Map(players.flatMap((p) => {
    const r = p.clubSlug ? reliability.get(p.clubSlug) : undefined;
    // Rounded down: a club under the line never reads "9 von 11".
    return r && r.hits < OFTEN_WRONG ? [[p.clubSlug!, { name: p.clubName ?? p.clubSlug!, hits: Math.floor(r.hits) }] as const] : [];
  })).values()].slice(0, 2);
  if (clubs.length) {
    out.push(`Bei ${clubs.map((c) => c.name).join(" und ")} lag LigaInsider im Schnitt nur bei ${clubs.map((c) => c.hits).join(" bzw. ")} von 11 richtig.`);
  }
  const games = gameRows(inXi);
  // How many are in the predicted XI alone tells the manager nothing new.
  return games.length || out.length ? { inXi: inXi.length, total: players.length, games, notes: out } : undefined;
}
