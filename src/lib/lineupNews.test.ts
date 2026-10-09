import { describe, expect, it } from "vitest";
import { confirmedLineup } from "./lineupNews.ts";

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
