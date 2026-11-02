import { describe, expect, it } from "vitest";
import { composeSummary, summaryVisible, type SummaryInput, type SummaryPlayer } from "./compose.ts";
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

describe("composeSummary", () => {
  it("is empty when not visible", () => {
    expect(composeSummary(input([withMatchup("Saibari", 0.5)], { firstKickoff: "2026-11-01T14:30:00Z" }))).toEqual([]);
  });

  it("shows nothing when there's nothing to say beyond how many are in the predicted XI", () => {
    const players: SummaryPlayer[] = [{ name: "A", inPredictedXi: true }, { name: "B", inPredictedXi: false }, { name: "C", inPredictedXi: true }];
    expect(composeSummary(input(players))).toEqual([]);
  });

  const outlook = (team: string, opponent: string, home: boolean, win: number, cleanSheet?: number) => ({ team, opponent, home, win, ...(cleanSheet !== undefined ? { cleanSheet } : {}) });
  const xi = (name: string, o: ReturnType<typeof outlook>, extra: Partial<SummaryPlayer> = {}): SummaryPlayer => ({ name, inPredictedXi: true, outlook: o, ...extra });

  it("names his players with clear favourites, one club after the other, strongest first", () => {
    const bvb = outlook("Dortmund", "Elversberg", true, 74);
    const players = [xi("Nmecha", bvb), xi("Guirassy", bvb), xi("Gomis", outlook("Leipzig", "Augsburg", true, 65)), xi("Schick", outlook("Leverkusen", "Köln", false, 55)), xi("Gerl", outlook("HSV", "Gladbach", true, 40)), { name: "Bank", inPredictedXi: false, outlook: outlook("Bayern", "Mainz", false, 66) }];
    const out = composeSummary(input(players));
    expect(out[0]).toBe("Von deinen 6 Spielern stehen 5 in der voraussichtlichen Startelf.");
    expect(out[1]).toBe("Gute Woche: Nmecha und Guirassy spielen mit Dortmund als klarer Favorit gegen Elversberg (74 % Siegchance), Gomis mit Leipzig gegen Augsburg (65 %) und Schick mit Leverkusen bei Köln (55 %).");
  });

  it("names the outsiders, weakest first", () => {
    const players = [xi("Friedl", outlook("Bremen", "Stuttgart", false, 19)), xi("Caci", outlook("Mainz", "Bayern", true, 17)), xi("Gerl", outlook("HSV", "Gladbach", true, 40))];
    expect(composeSummary(input(players))[1]).toBe("Schwer wird's für Caci (Mainz gegen Bayern, 17 % Siegchance) und Friedl (Bremen bei Stuttgart, 19 %).");
  });

  it("adds where a named player does much better or worse at this venue", () => {
    const players = [
      xi("Nmecha", outlook("Dortmund", "Elversberg", true, 74), { venue: { index: 1.4, games: 4 } }),
      xi("Caci", outlook("Mainz", "Bayern", true, 17), { venue: { index: 1.35, games: 3 } }),
      xi("Friedl", outlook("Bremen", "Stuttgart", false, 19), { venue: { index: 1.1, games: 3 } }),
    ];
    const [, good, hard] = composeSummary(input(players));
    expect(good).toBe("Gute Woche: Nmecha spielt mit Dortmund als klarer Favorit gegen Elversberg (74 % Siegchance); zu Hause holt Nmecha zudem deutlich mehr Punkte als auswärts.");
    expect(hard).toBe("Schwer wird's für Caci (Mainz gegen Bayern, 17 % Siegchance) und Friedl (Bremen bei Stuttgart, 19 %); zu Hause holt Caci allerdings deutlich mehr Punkte als auswärts.");
  });

  it("names goalkeepers and defenders with a good chance of a clean sheet", () => {
    const players = [
      xi("Seimen", outlook("Stuttgart", "Bremen", true, 62, 48), { position: 1 }),
      xi("Quansah", outlook("Leverkusen", "Köln", false, 55, 41), { position: 2 }),
      xi("Schick", outlook("Leverkusen", "Köln", false, 55, 41), { position: 4 }),
      xi("Friedl", outlook("Bremen", "Stuttgart", false, 19, 20), { position: 2 }),
    ];
    expect(composeSummary(input(players)).at(-1)).toBe("Gute Chance auf zu Null für Seimen (48 %) und Quansah (41 %).");
  });

  it("names at most three matchups, those that stand out most", () => {
    const players = [withMatchup("A", 0.95), withMatchup("B", 0.5), withMatchup("C", 1.9), withMatchup("D", 0.65), withMatchup("E", 1.32)];
    const [, matchups] = composeSummary(input(players));
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
    const out = composeSummary(input(players, { reliability: new Map([["rb-leipzig", { matchdays: 3, hits: 8.6 }]]) }));
    expect(out[0]).toBe("Von deinen 1 Spielern steht 1 in der voraussichtlichen Startelf. 1 davon bei Vereinen, deren Prognose oft danebenliegt.");
    // 8.6 is below 9: rounded down, so the sentence never says "9 von 11" for a club under the line.
    expect(out.at(-1)).toBe("Bei RB Leipzig lag LigaInsider im Schnitt nur bei 8 von 11 richtig.");
  });

  it("warns about rotation around a cup game", () => {
    const near = { id: "c", competition: "Champions League", kickoff: "2026-11-04T20:00:00Z", home: "Atlético Madrid", away: "Bayern Munich" };
    const players: SummaryPlayer[] = [{ name: "Laimer", inPredictedXi: true, clubName: "FC Bayern München", rotation: { near, nearStarts: 0, nearGames: 2, usualRate: 1 } }];
    expect(composeSummary(input(players)).at(-1)).toBe("Rotationsgefahr bei Laimer: FC Bayern München spielt am Mittwoch in der Champions League, und neben solchen Spielen stand er zuletzt nur 0 von 2 Mal in der Startelf.");
  });
});
