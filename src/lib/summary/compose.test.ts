import { describe, expect, it } from "vitest";
import { composeSummary, summaryVisible, type SummaryInput, type SummaryPlayer } from "./compose.ts";
import type { Profile } from "./profile.ts";

const NOW = new Date("2026-11-05T12:00:00Z");
const KICKOFF = "2026-11-06T19:30:00Z";
const profile: Profile = { games: 8, avg: 100, shares: { attack: 0.6, duel: 0.4 }, top: "attack", byContext: [] };
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

  it("opens with how many of his players are in the predicted XI", () => {
    const players: SummaryPlayer[] = [{ name: "A", inPredictedXi: true }, { name: "B", inPredictedXi: false }, { name: "C", inPredictedXi: true }];
    expect(composeSummary(input(players))).toEqual(["Von deinen 3 Spielern stehen 2 in der voraussichtlichen Startelf."]);
  });

  it("names at most three matchups, those that stand out most", () => {
    const players = [withMatchup("A", 0.95), withMatchup("B", 0.5), withMatchup("C", 1.9), withMatchup("D", 0.65), withMatchup("E", 1.32)];
    const [, matchups] = composeSummary(input(players));
    expect(matchups).toContain("B holt auswärts gegen formstarke Teams nur halb so viele Punkte wie sonst");
    expect(matchups).toContain("C holt auswärts gegen formstarke Teams doppelt so viele Punkte wie sonst");
    expect(matchups).toContain("D holt auswärts gegen formstarke Teams deutlich weniger Punkte als sonst");
    expect(matchups).not.toContain("E holt");
    expect(matchups).not.toContain("A holt");
    expect(matchups).toContain("Samstag bei Union Berlin, 13 Punkte aus den letzten 5 Spielen");
  });

  it("warns about clubs whose prediction was often wrong", () => {
    const players: SummaryPlayer[] = [{ name: "Baumgartner", inPredictedXi: true, clubSlug: "rb-leipzig", clubName: "RB Leipzig" }];
    const out = composeSummary(input(players, { reliability: new Map([["rb-leipzig", { matchdays: 3, hits: 7.4 }]]) }));
    expect(out[0]).toBe("Von deinen 1 Spielern steht 1 in der voraussichtlichen Startelf. 1 davon bei Vereinen, deren Prognose oft danebenliegt.");
    expect(out.at(-1)).toBe("Bei RB Leipzig lag LigaInsider zuletzt nur bei 7 von 11 richtig.");
  });

  it("warns about rotation around a cup game", () => {
    const near = { id: "c", competition: "Champions League", kickoff: "2026-11-04T20:00:00Z", home: "Atlético Madrid", away: "Bayern Munich" };
    const players: SummaryPlayer[] = [{ name: "Laimer", inPredictedXi: true, clubName: "FC Bayern München", rotation: { near, nearStarts: 0, nearGames: 2, usualRate: 1 } }];
    expect(composeSummary(input(players)).at(-1)).toBe("Rotationsgefahr bei Laimer: FC Bayern München spielt am Mittwoch in der Champions League, und neben solchen Spielen stand er zuletzt nur 0 von 2 Mal in der Startelf.");
  });
});
