import { describe, expect, it } from "vitest";
import { summaryView, summaryVisible, type SummaryInput, type SummaryPlayer } from "./compose.ts";
import type { Profile } from "./profile.ts";

const NOW = new Date("2026-11-05T12:00:00Z");
const KICKOFF = "2026-11-06T19:30:00Z";
const profile: Profile = { games: 8, avg: 100, shares: { attack: 0.6, duel: 0.4 }, top: "attack", byContext: [], byVenue: {} };
const form = { games: 8, ppg: 2, momentum: 13, last: 5 };
const withMatchup = (name: string, index: number): SummaryPlayer => ({
  name, inPredictedXi: true, profile,
  matchup: { index, games: 3, context: { home: false, opponent: "strong" }, opponentName: "Union Berlin", opponentForm: form, day: "Samstag" },
});
const input = (players: SummaryPlayer[], extra: Partial<SummaryInput> = {}): SummaryInput => ({ now: NOW, firstKickoff: KICKOFF, players, reliability: new Map(), ...extra });

describe("summaryVisible", () => {
  it("is shown until the matchday's first kickoff, when Kickbase locks the lineup", () => {
    expect(summaryVisible(new Date("2026-11-06T19:29:00Z"), KICKOFF)).toBe(true);
    expect(summaryVisible(new Date("2026-11-06T19:30:00Z"), KICKOFF)).toBe(false);
    // Lineups of a matchday that's over have a first kickoff in the past; none known: nothing to say.
    expect(summaryVisible(NOW, undefined)).toBe(false);
  });
});

describe("summaryView", () => {
  it("is nothing when not visible", () => {
    expect(summaryView(input([withMatchup("Saibari", 0.5)], { firstKickoff: "2026-11-01T14:30:00Z" }))).toBeUndefined();
  });

  it("is nothing when there's nothing to say beyond how many are in the predicted XI", () => {
    const players: SummaryPlayer[] = [{ name: "A", inPredictedXi: true }, { name: "B", inPredictedXi: false }, { name: "C", inPredictedXi: true }];
    expect(summaryView(input(players))).toBeUndefined();
  });

  const outlook = (team: string, opponent: string, home: boolean, win: number, cleanSheet?: number) => ({
    team, opponent, home, win, kickoff: KICKOFF, crest: `/img/clubs/${team}.png`, ...(cleanSheet !== undefined ? { cleanSheet } : {}),
  });
  const xi = (name: string, o: NonNullable<SummaryPlayer["outlook"]>, extra: Partial<SummaryPlayer> = {}): SummaryPlayer => ({ name, inPredictedXi: true, outlook: o, ...extra });

  it("is one row per game of his predicted starters, the best chance first", () => {
    const bvb = outlook("Dortmund", "Elversberg", true, 74);
    const b04 = outlook("Leverkusen", "Köln", false, 55);
    const players = [xi("Quansah", b04), xi("Nmecha", bvb), xi("Friedl", outlook("Bremen", "Stuttgart", false, 19)), xi("Schick", b04), xi("Guirassy", bvb), { name: "Bank", inPredictedXi: false, outlook: outlook("Bayern", "Mainz", false, 66) }];
    const view = summaryView(input(players))!;
    expect({ inXi: view.inXi, total: view.total }).toEqual({ inXi: 5, total: 6 });
    expect(view.games.map((g) => [g.team, g.win, g.players.map((p) => p.name)])).toEqual([
      ["Dortmund", 74, ["Nmecha", "Guirassy"]],
      ["Leverkusen", 55, ["Quansah", "Schick"]],
      ["Bremen", 19, ["Friedl"]],
    ]);
    expect(view.games[0]).toMatchObject({ opponent: "Elversberg", home: true, kickoff: KICKOFF, crest: "/img/clubs/Dortmund.png" });
  });

  it("explains in a few words how the week looks, beyond the bars", () => {
    const players = [
      xi("Nmecha", outlook("Dortmund", "Elversberg", true, 74)),
      xi("Seimen", outlook("Stuttgart", "Bremen", true, 62)),
      xi("Schick", outlook("Leverkusen", "Köln", false, 45)),
      xi("Friedl", outlook("Bremen", "Stuttgart", false, 19)),
    ];
    expect(summaryView(input(players))!.text).toEqual(["2 deiner 4 Starter spielen bei Favoriten, 1 bei einem klaren Außenseiter."]);
  });

  it("says when what a player's points depend on fits this week's game, or doesn't", () => {
    const players = [
      xi("Schick", { ...outlook("Leverkusen", "Köln", false, 55), goals: 2.3 }, { reliance: { kind: "goals", share: 0.4 } }),
      xi("Caci", { ...outlook("Mainz", "Bayern", true, 17), goals: 0.8 }, { reliance: { kind: "goals", share: 0.27 } }),
      xi("Friedl", outlook("Bremen", "Stuttgart", false, 19, 10), { reliance: { kind: "cleansheet", share: 0.09 }, position: 2 }),
      xi("Seimen", outlook("Stuttgart", "Bremen", true, 62, 29), { reliance: { kind: "team", share: 0.2 }, position: 1 }),
    ];
    const view = summaryView(input(players))!;
    expect(view.text.slice(1)).toEqual([
      "Rückenwind: Schick lebt von Toren und Vorlagen, und Leverkusen werden bei Köln 2,3 Tore zugetraut; Seimen punktet viel über den Siegbonus, und Stuttgart gewinnt gegen Bremen mit 62 % Wahrscheinlichkeit. Unbedingt drin lassen.",
      "Vorsicht: Friedl holt viele Punkte über zu Null, aber die Chance darauf liegt bei Stuttgart nur bei 10 %; Caci lebt von Toren und Vorlagen, aber Mainz werden gegen Bayern nur 0,8 Tore zugetraut. Ein Blick auf deine Bank lohnt sich.",
    ]);
    const notes = Object.fromEntries(view.games.flatMap((g) => g.players.map((p) => [p.name, p.note])));
    expect(notes).toMatchObject({
      Schick: "lebt von Toren, 2,3 Tore erwartet",
      Caci: "lebt von Toren, nur 0,8 Tore erwartet",
      Friedl: "viele Zu-Null-Punkte, nur 10 % zu Null",
      Seimen: "viel Siegbonus, 62 % Siegchance",
    });
  });

  it("judges a goal getter by his own chance to score or assist once the player odds are out", () => {
    const players = [xi("Schick", { ...outlook("Leverkusen", "Köln", false, 55), goals: 1.6, scorer: 52 }, { reliance: { kind: "goals", share: 0.4 } })];
    const view = summaryView(input(players))!;
    expect(view.text.at(-1)).toBe("Rückenwind: Schick lebt von Toren und Vorlagen, und seine Chance auf Tor oder Vorlage liegt bei Köln bei 52 %. Unbedingt drin lassen.");
    expect(view.games[0].players[0].note).toBe("lebt von Toren, 52 % Tor oder Vorlage");
  });

  it("looks only at the eleven he set in Kickbase, and names those LigaInsider doesn't see in the XI", () => {
    const b04 = outlook("Leverkusen", "Köln", false, 55);
    const players: SummaryPlayer[] = [
      xi("Schick", b04, { inLineup: true }),
      { name: "Gomis", inPredictedXi: false, inLineup: true, startNote: "nur Alternative", outlook: outlook("Leipzig", "Augsburg", true, 65) },
      { name: "Juranović", inPredictedXi: false, inLineup: true, startNote: "nicht in der Startelf", outlook: outlook("Union Berlin", "Freiburg", false, 17) },
      xi("Götze", outlook("Paderborn", "Frankfurt", true, 32), { inLineup: false }),
    ];
    const view = summaryView(input(players))!;
    expect({ inXi: view.inXi, total: view.total }).toEqual({ inXi: 1, total: 3 });
    expect(view.games.map((g) => g.team)).toEqual(["Leipzig", "Leverkusen", "Union Berlin"]);
    expect(view.games[0].players).toEqual([{ name: "Gomis", note: "nur Alternative" }]);
    expect(view.text).toContain("Nicht in der voraussichtlichen Startelf: Gomis (nur Alternative) und Juranović (nicht in der Startelf). Ein Blick auf deine Bank lohnt sich.");
  });

  it("points to the bench only once", () => {
    const players: SummaryPlayer[] = [
      { name: "Gomis", inPredictedXi: false, inLineup: true, startNote: "nur Alternative", outlook: outlook("Leipzig", "Augsburg", true, 65) },
      xi("Caci", { ...outlook("Mainz", "Bayern", true, 17), goals: 0.8 }, { reliance: { kind: "goals", share: 0.27 }, inLineup: true }),
    ];
    const text = summaryView(input(players))!.text.join(" ");
    expect(text.split("Ein Blick auf deine Bank lohnt sich.").length - 1).toBe(1);
    expect(text.endsWith("Ein Blick auf deine Bank lohnt sich.")).toBe(true);
  });

  it("notes where a player does clearly better or worse at this venue, and a good clean sheet chance for goalkeepers and defenders", () => {
    const players = [
      xi("Nmecha", outlook("Dortmund", "Elversberg", true, 74, 38), { venue: { index: 1.4, games: 4 }, position: 3 }),
      xi("Caci", outlook("Mainz", "Bayern", true, 17, 7), { venue: { index: 0.65, games: 3 }, position: 2 }),
      xi("Schick", outlook("Leverkusen", "Köln", false, 55, 41), { venue: { index: 1.35, games: 3 }, position: 4 }),
      xi("Quansah", outlook("Leverkusen", "Köln", false, 55, 41), { venue: { index: 1.1, games: 3 }, position: 2 }),
      xi("Seimen", outlook("Stuttgart", "Bremen", true, 62, 48), { venue: { index: 1.5, games: 3 }, position: 1 }),
    ];
    const notes = Object.fromEntries(summaryView(input(players))!.games.flatMap((g) => g.players.map((p) => [p.name, p.note])));
    expect(notes).toEqual({
      Nmecha: "zu Hause stärker",
      Caci: "zu Hause schwächer",
      Schick: "auswärts stärker",
      Quansah: "41 % zu Null",
      Seimen: "zu Hause stärker, 48 % zu Null",
    });
  });

  it("names at most three matchups, those that stand out most", () => {
    const players = [withMatchup("A", 0.95), withMatchup("B", 0.5), withMatchup("C", 1.9), withMatchup("D", 0.65), withMatchup("E", 1.32)];
    const [matchups] = summaryView(input(players))!.notes;
    expect(matchups).toContain("B holt auswärts gegen formstarke Teams nur halb so viele Punkte wie sonst");
    expect(matchups).toContain("C holt auswärts gegen formstarke Teams doppelt so viele Punkte wie sonst");
    expect(matchups).toContain("D holt auswärts gegen formstarke Teams deutlich weniger Punkte als sonst");
    expect(matchups).not.toContain("E holt");
    expect(matchups).not.toContain("A holt");
    // The points are the opponent's, not his: said so.
    expect(matchups).toContain("Samstag bei Union Berlin, Gegner mit 13 Punkten aus den letzten 5 Spielen");
  });

  it("warns about clubs whose prediction was often wrong", () => {
    const players: SummaryPlayer[] = [{ name: "Baumgartner", inPredictedXi: true, clubSlug: "rb-leipzig", clubName: "RB Leipzig" }];
    const out = summaryView(input(players, { reliability: new Map([["rb-leipzig", { matchdays: 3, hits: 8.6 }]]) }))!.notes;
    // 8.6 is below 9: rounded down, so the sentence never says "9 von 11" for a club under the line.
    expect(out.at(-1)).toBe("Bei RB Leipzig lag LigaInsider im Schnitt nur bei 8 von 11 richtig.");
  });

  it("warns about rotation around a cup game", () => {
    const near = { id: "c", competition: "Champions League", kickoff: "2026-11-04T20:00:00Z", home: "Atlético Madrid", away: "Bayern Munich" };
    const players: SummaryPlayer[] = [{ name: "Laimer", inPredictedXi: true, clubName: "FC Bayern München", rotation: { near, nearStarts: 0, nearGames: 2, usualRate: 1 } }];
    expect(summaryView(input(players))!.notes.at(-1)).toBe("Rotationsgefahr bei Laimer: FC Bayern München spielt am Mittwoch in der Champions League, und neben solchen Spielen stand er zuletzt nur 0 von 2 Mal in der Startelf.");
  });
});
