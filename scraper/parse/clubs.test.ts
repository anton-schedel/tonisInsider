import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseClubs } from "./clubs.ts";

const fx = (name: string) => readFileSync(join(import.meta.dirname, "..", "__fixtures__", name), "utf8");

describe("parseClubs", () => {
  it("finds all 18 Bundesliga clubs with name and crest", () => {
    const clubs = parseClubs(fx("news-bundesliga.html"));
    expect(clubs).toHaveLength(18);
    expect(clubs.find((c) => c.id === 14)).toEqual({
      id: 14,
      slug: "borussia-dortmund",
      name: "Borussia Dortmund",
      crestUrl: "https://cdn.ligainsider.de/images/teams/small/borussia-dortmund-wappen.png",
    });
  });
});
