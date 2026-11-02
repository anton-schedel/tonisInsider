import { GROUP_LABEL } from "./groups.ts";
import type { Context, Profile } from "./profile.ts";
import type { Reliability } from "./reliability.ts";
import type { Rotation } from "./rotation.ts";
import type { Form } from "./teamForm.ts";
import type { Reliance } from "./reliance.ts";

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
  outlook?: { team: string; opponent: string; home: boolean; win: number; cleanSheet?: number; kickoff: string; crest?: string; goals?: number };
  /** The source his points depend on clearly more than others in his position (reliance.ts). */
  reliance?: { kind: Reliance; share: number };
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
/** text: a few sentences on how the week looks (above the rows); notes: what stands out beyond the odds (below). */
export type SummaryView = { inXi: number; total: number; text: string[]; games: GameRow[]; notes: string[] };

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

const RELIANCE_NOTE: Record<Reliance, string> = { goals: "lebt von Toren", cleansheet: "viele Zu-Null-Punkte", team: "viel Siegbonus" };

/** "zu Hause stärker", "48 % zu Null", "lebt von Toren": what stands out about him in this game. */
function noteOf(p: SummaryPlayer): string | undefined {
  const o = p.outlook!;
  const notes = [
    p.reliance ? RELIANCE_NOTE[p.reliance.kind] : undefined,
    p.venue && Math.abs(p.venue.index - 1) >= STANDS_OUT ? `${where(o.home)} ${p.venue.index > 1 ? "stärker" : "schwächer"}` : undefined,
    (p.position === 1 || p.position === 2) && (o.cleanSheet ?? 0) >= CLEAN_SHEET ? `${o.cleanSheet} % zu Null` : undefined,
  ].filter(Boolean);
  return notes.length ? notes.join(", ") : undefined;
}

const FAVOURITE = 55;
const OUTSIDER = 25;
const against = (o: NonNullable<SummaryPlayer["outlook"]>) => `${o.home ? "gegen" : "bei"} ${o.opponent}`;
const decimal = (n: number) => n.toFixed(1).replace(".", ",");

/** "2 deiner 8 Starter spielen bei Favoriten, 1 bei einem klaren Außenseiter." */
function overview(inXi: SummaryPlayer[]): string | undefined {
  const fav = inXi.filter((p) => p.outlook && p.outlook.win >= FAVOURITE).length;
  const out = inXi.filter((p) => p.outlook && p.outlook.win <= OUTSIDER).length;
  if (!fav && !out) return undefined;
  const outsiders = (n: number) => (n === 1 ? "bei einem klaren Außenseiter" : "bei klaren Außenseitern");
  if (!fav) return `${out} deiner ${inXi.length} Starter ${out === 1 ? "spielt" : "spielen"} ${outsiders(out)}.`;
  return `${fav} deiner ${inXi.length} Starter ${fav === 1 ? "spielt bei einem Favoriten" : "spielen bei Favoriten"}${out ? `, ${out} ${outsiders(out)}` : ""}.`;
}

/**
 * What his points depend on against this week's numbers: [the number, from which it fits, up to which it doesn't].
 * Goals: his team's expected goals; clean sheet: its chance; win bonus: the win chance.
 */
const RELIANCE_CHECK: Record<Reliance, { value: (o: NonNullable<SummaryPlayer["outlook"]>) => number | undefined; good: number; bad: number }> = {
  goals: { value: (o) => o.goals, good: 2.2, bad: 1.35 },
  cleansheet: { value: (o) => o.cleanSheet, good: 40, bad: 20 },
  team: { value: (o) => o.win, good: 60, bad: 25 },
};

function relianceClause(p: SummaryPlayer, fits: boolean): string {
  const o = p.outlook!;
  const v = RELIANCE_CHECK[p.reliance!.kind].value(o)!;
  const only = fits ? "" : "nur ";
  const link = fits ? "und" : "aber";
  switch (p.reliance!.kind) {
    case "goals": return `${p.name} lebt von Toren und Vorlagen, ${link} ${o.team} werden ${against(o)} ${only}${decimal(v)} Tore zugetraut`;
    case "cleansheet": return `${p.name} holt viele Punkte über zu Null, ${link} die Chance darauf liegt ${against(o)} ${only}bei ${v} %`;
    case "team": return `${p.name} punktet viel über den Siegbonus, ${link} ${o.team} gewinnt ${against(o)} ${only}mit ${v} % Wahrscheinlichkeit`;
  }
}

/** "Rückenwind: …" and "Vorsicht: …": up to two players each, the clearest first. */
function relianceSentences(inXi: SummaryPlayer[]): string[] {
  const judged = inXi.flatMap((p) => {
    if (!p.reliance || !p.outlook) return [];
    const check = RELIANCE_CHECK[p.reliance.kind];
    const v = check.value(p.outlook);
    if (v === undefined) return [];
    if (v >= check.good) return [{ p, fits: true, by: (v - check.good) / check.good }];
    if (v <= check.bad) return [{ p, fits: false, by: (check.bad - v) / check.bad }];
    return [];
  });
  const sentence = (fits: boolean, lead: string) => {
    const clauses = judged.filter((j) => j.fits === fits).sort((a, b) => b.by - a.by).slice(0, 2).map((j) => relianceClause(j.p, fits));
    return clauses.length ? [`${lead}: ${clauses.join("; ")}.`] : [];
  };
  return [...sentence(true, "Rückenwind"), ...sentence(false, "Vorsicht")];
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
  const text = [overview(inXi), ...relianceSentences(inXi)].filter((s): s is string => !!s);
  // How many are in the predicted XI alone tells the manager nothing new.
  return games.length || out.length ? { inXi: inXi.length, total: players.length, text, games, notes: out } : undefined;
}
