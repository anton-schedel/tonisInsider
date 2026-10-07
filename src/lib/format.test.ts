import { describe, it, expect } from "vitest";
import { dayLabel, fullDate, initials, kickoff, kickoffDay, time } from "./format.ts";

const NOW = new Date("2026-10-07T09:00:00Z");

describe("format", () => {
  it("shows Berlin time", () => {
    expect(time("2026-10-07T07:32:00.000Z")).toBe("09:32");
    expect(fullDate("2026-10-07T07:32:00.000Z")).toBe("07.10.2026 · 09:32");
  });

  it("labels today and yesterday by Berlin calendar day", () => {
    expect(dayLabel("2026-10-07T05:00:00Z", NOW)).toBe("Heute · Mi., 07.10.");
    expect(dayLabel("2026-10-06T21:59:00Z", NOW)).toBe("Gestern · Di., 06.10.");
    expect(dayLabel("2026-10-06T22:30:00Z", NOW)).toBe("Heute · Mi., 07.10.");
    expect(dayLabel("2026-10-04T12:00:00Z", NOW)).toBe("So., 04.10.");
  });

  it("formats kickoff", () => {
    expect(kickoff("2026-10-09T18:30:00.000Z")).toBe("Fr. · 09.10., 20:30 Uhr");
  });

  it("formats the short kickoff day for fixture cards", () => {
    expect(kickoffDay("2026-10-09T18:30:00.000Z")).toBe("Fr. 09.10.");
  });

  it("builds initials for the photo fallback", () => {
    expect(initials("Gregor Kobel")).toBe("GK");
    expect(initials("N. Schlotterbeck")).toBe("NS");
    expect(initials("Kobel")).toBe("K");
  });
});
