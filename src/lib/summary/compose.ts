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
};

export type SummaryInput = { now: Date; firstKickoff?: string; players: SummaryPlayer[]; reliability: Map<string, Reliability> };

/** A matchup is named from 30 % off his average; a club's prediction is "often wrong" below 9 of 11. */
const STANDS_OUT = 0.3;
const OFTEN_WRONG = 9;

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

function competition(name: string): string {
  return name === "DFB-Pokal" ? "im DFB-Pokal" : `in der ${name}`;
}

export function composeSummary(input: SummaryInput): string[] {
  if (!summaryVisible(input.now, input.firstKickoff)) return [];
  const { players, reliability } = input;
  const out: string[] = [];

  const inXi = players.filter((p) => p.inPredictedXi);
  const unsure = inXi.filter((p) => p.clubSlug && (reliability.get(p.clubSlug)?.hits ?? OFTEN_WRONG) < OFTEN_WRONG);
  out.push(`Von deinen ${players.length} Spielern ${inXi.length === 1 ? "steht" : "stehen"} ${inXi.length} in der voraussichtlichen Startelf.`
    + (unsure.length ? ` ${unsure.length} davon bei Vereinen, deren Prognose oft danebenliegt.` : ""));

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
  return out;
}
