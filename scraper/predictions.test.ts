import { describe, expect, it } from "vitest";
import { addConfirmed, predictionDue, recordPredictions, snapshotPrediction } from "./predictions.ts";
import type { Article, Lineup, LineupPlayer } from "./types.ts";

const player = (id: number, name: string, extra: Partial<LineupPlayer> = {}): LineupPlayer => ({ id, slug: name.toLowerCase(), name, status: "set", ...extra });
const lineup = (slug: string, kickoff: string | undefined, matchday = 10, lines: LineupPlayer[][] = [[player(1, "Kobel")], [player(2, "Anton")]]): Lineup => ({
  club: { id: slug.length, slug, name: slug },
  opponent: { name: "Gegner", home: true },
  matchday,
  kickoff,
  formation: "4-3-3",
  lines,
  updatedAt: "2026-11-06T17:00:00.000Z",
});

// Matchday 10: Friday 20:30, Saturday 15:30 (Berlin) = 19:30 and 14:30 UTC.
const FRIDAY = "2026-11-06T19:30:00.000Z";
const SATURDAY = "2026-11-07T14:30:00.000Z";
const lineups = [lineup("borussia-dortmund", SATURDAY), lineup("fc-bayern-muenchen", FRIDAY), lineup("sc-freiburg", FRIDAY)];

describe("predictionDue", () => {
  it("is the matchday from 90 minutes before its first kickoff until that kickoff", () => {
    expect(predictionDue(lineups, [], new Date("2026-11-06T17:59:00.000Z"))).toBeUndefined();
    expect(predictionDue(lineups, [], new Date("2026-11-06T18:00:00.000Z"))).toEqual({ matchday: 10, firstKickoff: FRIDAY });
    expect(predictionDue(lineups, [], new Date("2026-11-06T19:29:00.000Z"))).toEqual({ matchday: 10, firstKickoff: FRIDAY });
    // The lineup is locked from the first kickoff on: a later prediction is no use to a manager.
    expect(predictionDue(lineups, [], new Date("2026-11-06T19:30:00.000Z"))).toBeUndefined();
  });

  it("is saved once per matchday", () => {
    const saved = [snapshotPrediction(lineups, 10, FRIDAY, new Date("2026-11-06T18:00:00.000Z"))];
    expect(predictionDue(lineups, saved, new Date("2026-11-06T18:10:00.000Z"))).toBeUndefined();
  });

  it("saves the same matchday number again in the next season", () => {
    const saved = [snapshotPrediction(lineups, 10, FRIDAY, new Date("2026-11-06T18:00:00.000Z"))];
    const nextSeason = [lineup("borussia-dortmund", "2027-11-05T19:30:00.000Z")];
    expect(predictionDue(nextSeason, saved, new Date("2027-11-05T18:00:00.000Z"))).toEqual({ matchday: 10, firstKickoff: "2027-11-05T19:30:00.000Z" });
  });

  it("ignores lineups without a kickoff", () => {
    expect(predictionDue([lineup("a", undefined)], [], new Date("2026-11-06T18:00:00.000Z"))).toBeUndefined();
  });
});

describe("snapshotPrediction", () => {
  it("keeps each club's predicted XI with the doubtful spots and their alternative", () => {
    const l = lineup("borussia-dortmund", SATURDAY, 10, [
      [player(1, "Kobel")],
      [player(2, "Anton", { status: "doubtful", alternative: { id: 3, slug: "sule", name: "Süle" } })],
    ]);
    const p = snapshotPrediction([l, lineup("x", SATURDAY, 11)], 10, FRIDAY, new Date("2026-11-06T18:00:00.000Z"));
    expect(p).toEqual({
      matchday: 10,
      firstKickoff: FRIDAY,
      savedAt: "2026-11-06T18:00:00.000Z",
      clubs: {
        "borussia-dortmund": {
          kickoff: SATURDAY,
          opponent: "Gegner",
          xi: [{ id: 1, name: "Kobel" }, { id: 2, name: "Anton", doubtful: true, alternative: { id: 3, name: "Süle" } }],
        },
      },
    });
  });

  it("skips a club whose page had no players", () => {
    const p = snapshotPrediction([lineup("leer", SATURDAY, 10, [])], 10, FRIDAY, new Date("2026-11-06T18:00:00.000Z"));
    expect(p.clubs).toEqual({});
  });
});

describe("addConfirmed", () => {
  const confirmed = (club: string, publishedAt: string, xi = "Kobel – Anton"): Pick<Article, "url" | "bodyHtml" | "club" | "publishedAt"> => ({
    url: `https://www.ligainsider.de/${club}/14/aufstellung-von-${club}-1/`,
    bodyHtml: `<p><b>Startelf:</b> ${xi}</p>`,
    club: { id: 14, slug: club, name: club },
    publishedAt,
  });
  const saved = [snapshotPrediction(lineups, 10, FRIDAY, new Date("2026-11-06T18:00:00.000Z"))];

  it("adds the confirmed XI LigaInsider posted shortly before the club's kickoff", () => {
    const [p] = addConfirmed(saved, [confirmed("borussia-dortmund", "2026-11-07T13:30:00.000Z")]);
    expect(p.clubs["borussia-dortmund"].confirmed).toBe("Kobel – Anton");
    expect(p.clubs["fc-bayern-muenchen"].confirmed).toBeUndefined();
  });

  it("ignores a lineup post from another match", () => {
    const [p] = addConfirmed(saved, [confirmed("borussia-dortmund", "2026-10-31T16:30:00.000Z")]);
    expect(p.clubs["borussia-dortmund"].confirmed).toBeUndefined();
  });

  it("keeps a confirmed XI once it's there (the post leaves the store after 30 days)", () => {
    const [once] = addConfirmed(saved, [confirmed("borussia-dortmund", "2026-11-07T13:30:00.000Z")]);
    expect(addConfirmed([once], [])[0].clubs["borussia-dortmund"].confirmed).toBe("Kobel – Anton");
  });
});

describe("recordPredictions", () => {
  it("saves the due matchday and fills in confirmed lineups, reporting whether anything changed", () => {
    const first = recordPredictions(undefined, lineups, [], new Date("2026-11-06T18:00:00.000Z"));
    expect(first.changed).toBe(true);
    expect(first.predictions).toHaveLength(1);
    const again = recordPredictions(first.predictions, lineups, [], new Date("2026-11-06T18:10:00.000Z"));
    expect(again.changed).toBe(false);
  });
});
