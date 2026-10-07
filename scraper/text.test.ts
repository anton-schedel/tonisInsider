import { describe, it, expect } from "vitest";
import { berlinToIso, cleanText, parseArticleId, parseClubHref, parseGermanDateTime, parsePlayerHref } from "./text.ts";

describe("text helpers", () => {
  it("removes soft hyphens and collapses whitespace", () => {
    expect(cleanText("  Kobel kann sich langfris­ti­gen\n  BVB-Verbleib ")).toBe("Kobel kann sich langfristigen BVB-Verbleib");
  });

  it("parses player, club and article hrefs", () => {
    expect(parsePlayerHref("/gregor-kobel_9357/")).toEqual({ slug: "gregor-kobel", id: 9357 });
    expect(parsePlayerHref("/borussia-dortmund/14/")).toBeUndefined();
    expect(parseClubHref("/borussia-dortmund/14/")).toEqual({ slug: "borussia-dortmund", id: 14 });
    expect(parseArticleId("/gregor-kobel_9357/kobel-kann-sich-langfristigen-bvb-verbleib-vorstellen-418778/")).toBe(418778);
    expect(parseArticleId("/deutschland-u21/33166/em-quali-fix-deutschlands-u21-besiegt-georgien-418765/")).toBe(418765);
    expect(parseArticleId("/borussia-dortmund/14/")).toBeUndefined();
  });

  it("converts Berlin wall-clock time to UTC in summer and winter", () => {
    expect(berlinToIso(2026, 10, 7, 9, 32)).toBe("2026-10-07T07:32:00.000Z");
    expect(berlinToIso(2026, 12, 5, 15, 30)).toBe("2026-12-05T14:30:00.000Z");
  });

  it("parses both German date formats used by LigaInsider", () => {
    expect(parseGermanDateTime("07.10.2026 - 09:32 Uhr")).toBe("2026-10-07T07:32:00.000Z");
    expect(parseGermanDateTime("Heimspiel Fr. 09.10.2026 | 20:30 gegen")).toBe("2026-10-09T18:30:00.000Z");
    expect(parseGermanDateTime("kein Datum")).toBeUndefined();
  });
});
