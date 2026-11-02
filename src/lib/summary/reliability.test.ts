import { describe, expect, it } from "vitest";
import { reliabilityByClub } from "./reliability.ts";
import { emptyHistory, type KbHistory } from "../../../scraper/kbHistory.ts";
import type { SavedPrediction } from "../../../scraper/predictions.ts";

const NAMES = ["Kobel", "Ryerson", "Anton", "Schlotterbeck", "Bensebaini", "Groß", "Nmecha", "Brandt", "Adeyemi", "Beier", "Guirassy"];
const kickoff = (md: number) => new Date(Date.UTC(2026, 9, md * 7, 17, 30)).toISOString();

/** Matchdays where LigaInsider predicted NAMES and Kickbase shows the first `right[i]` of them starting. */
function setup(right: number[], opts: { missingMatch?: number } = {}) {
  const history: KbHistory = { ...emptyHistory(), season: "2026/2027" };
  const predictions: SavedPrediction[] = right.map((r, i) => {
    const md = i + 1;
    if (opts.missingMatch !== md) history.matches[`m${md}`] = { day: md, date: kickoff(md), home: "3", away: "2", homeGoals: 1, awayGoals: 1 };
    NAMES.forEach((name, j) => {
      const id = `p${j}`;
      history.players[id] ??= { name, team: "3", position: 3, games: [] };
      history.players[id].games.push({ day: md, matchId: `m${md}`, team: "3", minutes: 90, start: j < r, points: 0 });
    });
    return {
      matchday: md, firstKickoff: kickoff(md), savedAt: kickoff(md),
      clubs: {
        "borussia-dortmund": { kickoff: kickoff(md), xi: NAMES.map((name, j) => ({ id: 100 + j, name })) },
        "fc-bayern-muenchen": { kickoff: kickoff(md), xi: [] },
      },
    };
  });
  return { history, predictions };
}
const kbTeamOf = (slug: string) => (slug === "borussia-dortmund" ? "3" : undefined);

describe("reliabilityByClub", () => {
  it("is how many predicted starters started, on average over the saved matchdays", () => {
    const { history, predictions } = setup([9, 10, 8]);
    expect(reliabilityByClub(predictions, history, kbTeamOf).get("borussia-dortmund")).toEqual({ matchdays: 3, hits: 9 });
  });

  it("needs three matchdays", () => {
    const { history, predictions } = setup([9, 10]);
    expect(reliabilityByClub(predictions, history, kbTeamOf).has("borussia-dortmund")).toBe(false);
  });

  it("leaves out a club it can't find at Kickbase, and matchdays Kickbase doesn't have yet", () => {
    const { history, predictions } = setup([9, 10, 8, 11], { missingMatch: 4 });
    const r = reliabilityByClub(predictions, history, kbTeamOf);
    expect(r.has("fc-bayern-muenchen")).toBe(false);
    expect(r.get("borussia-dortmund")).toEqual({ matchdays: 3, hits: 9 });
  });
});
