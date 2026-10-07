import { describe, it, expect } from "vitest";
import { chancesFor, sameClub } from "./odds.ts";
import type { OddsEvent } from "../../scraper/odds.ts";
import type { Fixture } from "./fixtures.ts";

const ev = (home: string, away: string, kickoff: string, h = 60, d = 22, a = 18): OddsEvent =>
  ({ home, away, kickoff, chances: { home: h, draw: d, away: a }, books: 5 });
const fx = (homeName: string, awayName: string, kickoff?: string) => ({ homeName, awayName, kickoff }) as Fixture;

describe("sameClub", () => {
  it.each([
    ["FC Bayern München", "Bayern Munich"],
    ["Bayer 04 Leverkusen", "Bayer Leverkusen"],
    ["1. FC Köln", "FC Koln"],
    ["1. FC Köln", "Cologne"],
    ["Borussia Mönchengladbach", "Borussia Monchengladbach"],
    ["1. FSV Mainz 05", "FSV Mainz 05"],
    ["FC Augsburg", "Augsburg"],
    ["1. FC Union Berlin", "Union Berlin"],
    ["SV 07 Elversberg", "SV Elversberg"],
    ["SC Paderborn 07", "SC Paderborn"],
    ["FC Schalke 04", "Schalke 04"],
    ["SV Werder Bremen", "Werder Bremen"],
    ["FC St. Pauli", "St Pauli"],
    ["1. FC Heidenheim 1846", "Heidenheim"],
    ["Hamburger SV", "Hamburg SV"],
    ["Borussia Mönchengladbach", "Gladbach"],
    ["TSG Hoffenheim", "TSG 1899 Hoffenheim"],
  ])("%s = %s", (ours, theirs) => expect(sameClub(ours, theirs)).toBe(true));

  it.each([
    ["Borussia Dortmund", "Borussia Monchengladbach"],
    ["FC Bayern München", "Bayer Leverkusen"],
    ["1. FC Köln", "1. FC Union Berlin"],
    ["SC Freiburg", "SC Paderborn"],
  ])("%s ≠ %s", (ours, theirs) => expect(sameClub(ours, theirs)).toBe(false));
});

describe("chancesFor", () => {
  const events = [
    ev("Borussia Dortmund", "Werder Bremen", "2026-10-09T18:30:00Z"),
    ev("Augsburg", "Bayern Munich", "2026-10-10T13:30:00Z", 15, 20, 65),
    ev("Werder Bremen", "Borussia Dortmund", "2027-03-01T18:30:00Z", 30, 25, 45),
  ];

  it("finds the match and orients the chances to our home and away team", () => {
    expect(chancesFor(fx("Borussia Dortmund", "SV Werder Bremen", "2026-10-09T18:30:00Z"), events)).toEqual({ home: 60, draw: 22, away: 18 });
    expect(chancesFor(fx("FC Augsburg", "FC Bayern München", "2026-10-10T13:30:00Z"), events)).toEqual({ home: 15, draw: 20, away: 65 });
  });

  it("flips the chances if the API lists home and away the other way round", () => {
    expect(chancesFor(fx("FC Bayern München", "FC Augsburg", "2026-10-10T13:30:00Z"), events)).toEqual({ home: 65, draw: 20, away: 15 });
  });

  it("ignores the same pairing on another matchday", () => {
    expect(chancesFor(fx("SV Werder Bremen", "Borussia Dortmund", "2026-10-09T18:30:00Z"), events)).toEqual({ home: 18, draw: 22, away: 60 });
    expect(chancesFor(fx("Borussia Dortmund", "SV Werder Bremen", "2026-12-01T18:30:00Z"), events)).toBeUndefined();
  });

  it("returns nothing without odds or without an opponent", () => {
    expect(chancesFor(fx("1. FC Köln", "SC Freiburg", "2026-10-10T13:30:00Z"), events)).toBeUndefined();
    expect(chancesFor(fx("Borussia Dortmund", "", "2026-10-09T18:30:00Z"), events)).toBeUndefined();
    expect(chancesFor(fx("Borussia Dortmund", "SV Werder Bremen"), undefined)).toBeUndefined();
  });
});
