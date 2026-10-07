import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseClubPage } from "./clubPage.ts";

const fx = (name: string) => readFileSync(join(import.meta.dirname, "..", "__fixtures__", name), "utf8");
const NOW = new Date("2026-10-07T09:00:00Z");
const BVB = { id: 14, slug: "borussia-dortmund", name: "Borussia Dortmund", crestUrl: "" };
const TSG = { id: 10, slug: "tsg-hoffenheim", name: "TSG Hoffenheim", crestUrl: "" };

describe("parseClubPage", () => {
  it("parses BVB's predicted XI line by line", () => {
    const l = parseClubPage(fx("club-bvb.html"), BVB, NOW);
    expect(l.lines.map((line) => line.map((p) => p.name))).toEqual([
      ["Kobel"],
      ["Gadou", "Anton", "N. Schlotterbeck"],
      ["Beier", "Veerman", "F. Nmecha", "Svensson"],
      ["Karetsas", "Guirassy", "Silva"],
    ]);
    expect(l.formation).toBe("3-4-3");
    expect(l.club).toEqual({ id: 14, slug: "borussia-dortmund", name: "Borussia Dortmund" });
    expect(l.updatedAt).toBe(NOW.toISOString());
  });

  it("reads the match: opponent, home/away, matchday, kickoff", () => {
    const l = parseClubPage(fx("club-bvb.html"), BVB, NOW);
    expect(l.opponent).toEqual({ name: "SV Werder Bremen", home: true });
    expect(l.matchday).toBe(5);
    expect(l.kickoff).toBe("2026-10-09T18:30:00.000Z");
  });

  it("marks doubtful players with label and alternative", () => {
    const l = parseClubPage(fx("club-bvb.html"), BVB, NOW);
    const schlotterbeck = l.lines[1][2];
    expect(schlotterbeck).toMatchObject({
      id: 20052, slug: "nico-schlotterbeck", status: "doubtful", statusLabel: "Angeschlagen",
      photoUrl: "https://cdn.ligainsider.de/images/player/team/minor/nico-schlotterbeck-dortmund-2627.jpg",
    });
    expect(schlotterbeck.alternative).toMatchObject({ id: 7791, name: "Bensebaini" });
    expect(l.lines[0][0]).toMatchObject({ name: "Kobel", status: "set", alternative: undefined });
  });

  it("keeps an alternative even when the player has no status icon", () => {
    const l = parseClubPage(fx("club-tsg.html"), TSG, NOW);
    expect(l.formation).toBe("4-4-2");
    const conte = l.lines[2][0];
    expect(conte.status).toBe("set");
    expect(conte.alternative?.name).toBe("Kramarić");
  });

  it("returns no lines for a page without a lineup (validation catches it)", () => {
    const l = parseClubPage("<html></html>", BVB, NOW);
    expect(l.lines).toEqual([]);
    expect(l.formation).toBe("");
  });
});
