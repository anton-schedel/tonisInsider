import { GROUP_LABEL } from "./groups.ts";
import type { Context, Profile } from "./profile.ts";
import type { Reliability } from "./reliability.ts";
import type { Rotation } from "./rotation.ts";
import type { Form } from "./teamForm.ts";
import type { Reliance } from "./reliance.ts";

export type SummaryPlayer = {
  name: string;
  inPredictedXi: boolean;
  /** In the eleven he set in Kickbase (undefined: unknown, then the whole squad counts). */
  inLineup?: boolean;
  /** For a lineup player LigaInsider doesn't see in the XI: "nur Alternative", "nicht in der Startelf", "fraglich". */
  startNote?: string;
  clubSlug?: string;
  /** LigaInsider's club name, for the sentences. */
  clubName?: string;
  profile?: Profile;
  matchup?: { index: number; games: number; context: Context; opponentName: string; opponentForm?: Form; day: string };
  rotation?: Rotation;
  /** Kickbase position (1 goalkeeper, 2 defender, 3 midfielder, 4 striker). */
  position?: number;
  /** This week's game: his club and the opponent (short names), kickoff, his club's crest, win and clean sheet chance in whole percent. */
  outlook?: { team: string; opponent: string; home: boolean; win: number; cleanSheet?: number; kickoff: string; crest?: string; goals?: number; scorer?: number };
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

const FAVOURITE = 55;
const OUTSIDER = 25;
const BENCH_HINT = "Ein Blick auf deine Bank lohnt sich.";
const against = (o: NonNullable<SummaryPlayer["outlook"]>) => `${o.home ? "gegen" : "bei"} ${o.opponent}`;
const decimal = (n: number) => n.toFixed(1).replace(".", ",");

/**
 * What his points depend on against this week's number: from `good` it fits, up to `bad` it doesn't. Goals: his
 * own chance to score or assist once the player odds are out (Thursday), before that his team's expected goals.
 */
type Check = { value: number; good: number; bad: number; note: (v: string) => string; clause: (fits: boolean, only: string) => string };

function checkOf(p: SummaryPlayer): Check | undefined {
  const o = p.outlook;
  if (!p.reliance || !o) return undefined;
  const link = (fits: boolean) => (fits ? "und" : "aber");
  switch (p.reliance.kind) {
    case "goals":
      if (o.scorer !== undefined) return {
        value: o.scorer, good: 45, bad: 20, note: (v) => `lebt von Toren, ${v}${o.scorer} % Tor oder Vorlage`,
        clause: (fits, only) => `${p.name} lebt von Toren und Vorlagen, ${link(fits)} seine Chance auf Tor oder Vorlage liegt ${against(o)} ${only}bei ${o.scorer} %`,
      };
      if (o.goals === undefined) return undefined;
      return {
        value: o.goals, good: 2.2, bad: 1.35, note: (v) => `lebt von Toren, ${v}${decimal(o.goals!)} Tore erwartet`,
        clause: (fits, only) => `${p.name} lebt von Toren und Vorlagen, ${link(fits)} ${o.team} werden ${against(o)} ${only}${decimal(o.goals!)} Tore zugetraut`,
      };
    case "cleansheet":
      if (o.cleanSheet === undefined) return undefined;
      return {
        value: o.cleanSheet, good: 40, bad: 20, note: (v) => `viele Zu-Null-Punkte, ${v}${o.cleanSheet} % zu Null`,
        clause: (fits, only) => `${p.name} holt viele Punkte über zu Null, ${link(fits)} die Chance darauf liegt ${against(o)} ${only}bei ${o.cleanSheet} %`,
      };
    case "team":
      return {
        value: o.win, good: 60, bad: 25, note: (v) => `viel Siegbonus, ${v}${o.win} % Siegchance`,
        clause: (fits, only) => `${p.name} punktet viel über den Siegbonus, ${link(fits)} ${o.team} gewinnt ${against(o)} ${only}mit ${o.win} % Wahrscheinlichkeit`,
      };
  }
}

/** "lebt von Toren, 2,3 Tore erwartet", "zu Hause stärker", "48 % zu Null", "nur Alternative": what stands out about him in this game. */
function noteOf(p: SummaryPlayer): string | undefined {
  const o = p.outlook!;
  const check = checkOf(p);
  const notes = [
    p.startNote,
    check?.note(check.value <= check.bad ? "nur " : ""),
    p.venue && Math.abs(p.venue.index - 1) >= STANDS_OUT ? `${where(o.home)} ${p.venue.index > 1 ? "stärker" : "schwächer"}` : undefined,
    p.reliance?.kind !== "cleansheet" && (p.position === 1 || p.position === 2) && (o.cleanSheet ?? 0) >= CLEAN_SHEET ? `${o.cleanSheet} % zu Null` : undefined,
  ].filter(Boolean);
  return notes.length ? notes.join(", ") : undefined;
}

/** "2 deiner 8 Starter spielen bei Favoriten, 1 bei einem klaren Außenseiter." */
function overview(starters: SummaryPlayer[]): string | undefined {
  const fav = starters.filter((p) => p.outlook && p.outlook.win >= FAVOURITE).length;
  const out = starters.filter((p) => p.outlook && p.outlook.win <= OUTSIDER).length;
  if (!fav && !out) return undefined;
  const outsiders = (n: number) => (n === 1 ? "bei einem klaren Außenseiter" : "bei klaren Außenseitern");
  if (!fav) return `${out} deiner ${starters.length} Starter ${out === 1 ? "spielt" : "spielen"} ${outsiders(out)}.`;
  return `${fav} deiner ${starters.length} Starter ${fav === 1 ? "spielt bei einem Favoriten" : "spielen bei Favoriten"}${out ? `, ${out} ${outsiders(out)}` : ""}.`;
}

/** "Nicht in der voraussichtlichen Startelf: Gomis (nur Alternative). …": lineup players LigaInsider doesn't see starting. */
function missing(lineup: SummaryPlayer[]): string | undefined {
  const out = lineup.filter((p) => !p.inPredictedXi);
  if (!out.length) return undefined;
  return `Nicht in der voraussichtlichen Startelf: ${list(out.map((p) => (p.startNote ? `${p.name} (${p.startNote})` : p.name)))}. ${BENCH_HINT}`;
}

/** "Rückenwind: …" and "Vorsicht: …": up to two players each, the clearest first, with what to do. */
function relianceSentences(starters: SummaryPlayer[]): string[] {
  const judged = starters.flatMap((p) => {
    const c = checkOf(p);
    if (!c) return [];
    if (c.value >= c.good) return [{ c, fits: true, by: (c.value - c.good) / c.good }];
    if (c.value <= c.bad) return [{ c, fits: false, by: (c.bad - c.value) / c.bad }];
    return [];
  });
  const sentence = (fits: boolean, lead: string, then: string) => {
    const clauses = judged.filter((j) => j.fits === fits).sort((a, b) => b.by - a.by).slice(0, 2).map((j) => j.c.clause(fits, fits ? "" : "nur "));
    return clauses.length ? [`${lead}: ${clauses.join("; ")}. ${then}`] : [];
  };
  return [...sentence(true, "Rückenwind", "Unbedingt drin lassen."), ...sentence(false, "Vorsicht", BENCH_HINT)];
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

  // The eleven he set in Kickbase, if known; else his whole squad (rows and counts then only the predicted XI).
  const lineup = players.filter((p) => p.inLineup);
  const scope = lineup.length ? lineup : players;
  const inXi = scope.filter((p) => p.inPredictedXi);
  const starters = lineup.length ? lineup : inXi;

  const matchups = scope
    .filter((p) => p.matchup && Math.abs(p.matchup.index - 1) >= STANDS_OUT)
    .sort((a, b) => Math.abs(b.matchup!.index - 1) - Math.abs(a.matchup!.index - 1))
    .slice(0, 3);
  if (matchups.length) out.push(`${matchups.map(matchupClause).join("; ")}.`);

  const rotating = scope.filter((p) => p.rotation).slice(0, 3);
  if (rotating.length === 1) {
    const [p] = rotating;
    const r = p.rotation!;
    out.push(`Rotationsgefahr bei ${p.name}: ${p.clubName ?? "Sein Verein"} spielt am ${weekday(r.near.kickoff)} ${competition(r.near.competition)}, und neben solchen Spielen stand er zuletzt nur ${r.nearStarts} von ${r.nearGames} Mal in der Startelf.`);
  } else if (rotating.length) {
    out.push(`Rotationsgefahr bei ${list(rotating.map((p) => p.name))}: Neben Europapokal- und Pokalspielen standen sie zuletzt deutlich seltener in der Startelf, und diese Woche steht wieder eins an.`);
  }

  const clubs = [...new Map(scope.flatMap((p) => {
    const r = p.clubSlug ? reliability.get(p.clubSlug) : undefined;
    // Rounded down: a club under the line never reads "9 von 11".
    return r && r.hits < OFTEN_WRONG ? [[p.clubSlug!, { name: p.clubName ?? p.clubSlug!, hits: Math.floor(r.hits) }] as const] : [];
  })).values()].slice(0, 2);
  if (clubs.length) {
    out.push(`Bei ${clubs.map((c) => c.name).join(" und ")} lag LigaInsider im Schnitt nur bei ${clubs.map((c) => c.hits).join(" bzw. ")} von 11 richtig.`);
  }
  const games = gameRows(starters);
  const text = [overview(starters), lineup.length ? missing(lineup) : undefined, ...relianceSentences(starters)].filter((s): s is string => !!s);
  // The bench hint once, at the end.
  const hinted = text.map((s, i) => (s.endsWith(BENCH_HINT) ? i : -1)).filter((i) => i >= 0);
  for (const i of hinted.slice(0, -1)) text[i] = text[i].slice(0, -BENCH_HINT.length - 1);
  // How many are in the predicted XI alone tells the manager nothing new.
  return games.length || out.length ? { inXi: inXi.length, total: scope.length, text, games, notes: out } : undefined;
}
