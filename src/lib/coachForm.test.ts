import { describe, expect, it } from "vitest";
import { localInput, namesOf, statusOf, toBody, type FormValues } from "./coachForm.ts";

const NOW = new Date("2026-10-24T12:00:00.000Z");
const base: FormValues = {
  type: "lineup", lines: ["Coach", "Gerl, Dallwig,  Chatfield", "", "Loibl"], bench: "Enciu, Schedel",
  opponent: "", ours: "0", theirs: "0", home: true, playerName: "", badge: "sonstiges",
  headline: " Aufstellung des TuS Schnöselmob ", text: "", when: "later", at: "2026-10-24T19:00", pin: "1", bots: true, context: "",
};

describe("namesOf", () => {
  it("splits at commas and drops empty names", () => {
    expect(namesOf(" Gerl,Dallwig ,, Chatfield ,")).toEqual(["Gerl", "Dallwig", "Chatfield"]);
    expect(namesOf("")).toEqual([]);
  });
});

describe("toBody", () => {
  it("turns a planned lineup into the API's body (local time → UTC)", () => {
    expect(toBody(base, NOW)).toEqual({
      type: "lineup",
      data: { headline: "Aufstellung des TuS Schnöselmob", lineup: { lines: [["Coach"], ["Gerl", "Dallwig", "Chatfield"], ["Loibl"]], bench: ["Enciu", "Schedel"] }, bots: { on: true } },
      publishedAt: new Date(2026, 9, 24, 19, 0).toISOString(),
      pinnedHours: 1,
    });
  });
  it("posts now when 'Jetzt' is picked", () => {
    expect(toBody({ ...base, when: "now" }, NOW).publishedAt).toBe(NOW.toISOString());
  });
  it("sends a result with numbers and the photo of player news", () => {
    expect(toBody({ ...base, type: "result", opponent: "FC X", ours: "3", theirs: "1", home: false, text: "Gut." }, NOW).data)
      .toEqual({ headline: "Aufstellung des TuS Schnöselmob", text: "Gut.", result: { opponent: "FC X", ours: 3, theirs: 1, home: false }, bots: { on: true } });
    const p = toBody({ ...base, type: "player", playerName: "Kevin Nguyen", badge: "angeschlagen", context: "Grippe" }, NOW, "ab12cd34ef56ab78");
    expect(p.data.player).toEqual({ name: "Kevin Nguyen", newsType: "angeschlagen" });
    expect(p.data.bots).toEqual({ on: true, context: "Grippe" });
    expect(p.imageId).toBe("ab12cd34ef56ab78");
  });
});

describe("statusOf", () => {
  it("says when a planned post comes and since when one is out", () => {
    expect(statusOf("2026-10-24T17:00:00.000Z", NOW)).toEqual({ planned: true, label: "Geplant: Sa. 24.10., 19:00" });
    expect(statusOf("2026-10-24T10:00:00.000Z", NOW)).toEqual({ planned: false, label: "Online seit Sa. 24.10., 12:00" });
  });
});

describe("localInput", () => {
  it("formats a time for a datetime-local field in local time", () => {
    const d = new Date(2026, 9, 24, 19, 5);
    expect(localInput(d.toISOString())).toBe("2026-10-24T19:05");
  });
});
