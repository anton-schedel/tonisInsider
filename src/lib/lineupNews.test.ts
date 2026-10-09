import { describe, expect, it } from "vitest";
import { confirmedClubs, confirmedLineup } from "./lineupNews.ts";

describe("confirmedLineup", () => {
  const url = "https://www.ligainsider.de/borussia-dortmund/14/aufstellung-von-borussia-dortmund-418926/";
  const bodyHtml = "<p><b>Startelf: </b>Kobel – Gadou, Anton – Guirassy<br>\n<b>Bank: </b>Meyer – Reggiani, Inácio</p>";
  it("reads XI and bench from a lineup post", () => {
    expect(confirmedLineup({ url, bodyHtml })).toEqual({ xi: "Kobel – Gadou, Anton – Guirassy", bench: "Meyer – Reggiani, Inácio" });
  });
  it("ignores other articles", () => {
    expect(confirmedLineup({ url: "https://www.ligainsider.de/gregor-kobel_9357/kobel-418778/", bodyHtml })).toBeUndefined();
  });
});

describe("confirmedClubs", () => {
  const url = "https://www.ligainsider.de/borussia-dortmund/14/aufstellung-von-borussia-dortmund-418926/";
  const bodyHtml = "<p><b>Startelf: </b>Kobel – Gadou<br><b>Bank: </b>Meyer</p>";
  const club = { id: 14, slug: "borussia-dortmund", name: "Borussia Dortmund" };
  const lineups = [{ club, kickoff: "2026-10-09T18:30:00.000Z" }];
  it("confirms a club whose lineup post came shortly before kickoff", () => {
    expect(confirmedClubs([{ url, bodyHtml, club, publishedAt: "2026-10-09T17:24:00.000Z" }], lineups)).toEqual(new Set([14]));
  });
  it("ignores last match's post and other news", () => {
    expect(confirmedClubs([{ url, bodyHtml, club, publishedAt: "2026-10-03T12:24:00.000Z" }], lineups).size).toBe(0);
    expect(confirmedClubs([{ url: "https://www.ligainsider.de/gregor-kobel_9357/x-1/", bodyHtml, club, publishedAt: "2026-10-09T17:24:00.000Z" }], lineups).size).toBe(0);
  });
});
