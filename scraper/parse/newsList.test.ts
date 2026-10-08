import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseNewsList, newsTypeFromLabel } from "./newsList.ts";

const fx = (name: string) => readFileSync(join(import.meta.dirname, "..", "__fixtures__", name), "utf8");

describe("parseNewsList", () => {
  it("parses all 15 entries of the Bundesliga overview", () => {
    const refs = parseNewsList(fx("news-bundesliga.html"));
    expect(refs).toHaveLength(15);
    expect(new Set(refs.map((r) => r.id)).size).toBe(15);
  });

  it("extracts id, absolute url, clean headline, news type and photo", () => {
    const refs = parseNewsList(fx("news-bundesliga.html"));
    expect(refs.find((r) => r.id === 418778)).toEqual({
      id: 418778,
      url: "https://www.ligainsider.de/gregor-kobel_9357/kobel-kann-sich-langfristigen-bvb-verbleib-vorstellen-418778/",
      headline: "Kobel kann sich langfristigen BVB-Verbleib vorstellen",
      newsType: "sonstiges",
      playerPhotoUrl: "https://cdn.ligainsider.de/images/player/team/minor/gregor-kobel-dortmund-2627.jpg",
      listedAgoMinutes: 60,
    });
    expect(refs.find((r) => r.id === 418776)?.newsType).toBe("verletzung");
    expect(refs.find((r) => r.id === 418777)?.newsType).toBe("fit");
  });

  it("reads how long ago each article was listed ('Vor 46 Min.', 'Vor 1 Std.'), none for 'Gestern'", () => {
    const refs = parseNewsList(fx("news-bundesliga.html"));
    expect(refs.find((r) => r.id === 418775)?.listedAgoMinutes).toBe(46);
    expect(refs.find((r) => r.id === 418778)?.listedAgoMinutes).toBe(60);
    expect(refs.find((r) => r.id === 418765)?.listedAgoMinutes).toBeUndefined();
  });

  it("parses the Testspiele overview", () => {
    expect(parseNewsList(fx("news-testspiele.html"))).toHaveLength(15);
  });

  it("returns an empty list for unrelated HTML", () => {
    expect(parseNewsList("<html><body><p>Wartung</p></body></html>")).toEqual([]);
  });

  it("maps unknown icon labels to sonstiges", () => {
    expect(newsTypeFromLabel("Sonstiges / Interview / Persönliches")).toBe("sonstiges");
    expect(newsTypeFromLabel(undefined)).toBe("sonstiges");
    expect(newsTypeFromLabel("Aufbautraining")).toBe("aufbautraining");
  });
});
