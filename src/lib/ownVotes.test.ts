import { describe, expect, it } from "vitest";
import { GROW_MS, grown, parseNewPoll, pollView, wholePercents } from "./ownVotes.ts";

const T0 = "2026-10-24T10:00:00.000Z";
const at = (ms: number) => new Date(Date.parse(T0) + ms);

describe("grown", () => {
  it("grows bot votes from 0 to all of them over 30 minutes, fast at first", () => {
    expect(grown(20, T0, at(0))).toBe(0);
    expect(grown(20, T0, at(-60_000))).toBe(0);
    expect(grown(20, T0, at(GROW_MS))).toBe(20);
    expect(grown(20, T0, at(2 * GROW_MS))).toBe(20);
    const half = grown(20, T0, at(GROW_MS / 2));
    expect(half).toBeGreaterThan(10);
    expect(half).toBeLessThan(20);
    let last = 0;
    for (let m = 0; m <= 30; m++) {
      const v = grown(20, T0, at(m * 60_000));
      expect(v).toBeGreaterThanOrEqual(last);
      last = v;
    }
  });
});

describe("pollView", () => {
  const opts = [{ id: 1, label: "Ja", bot: 12, real: 1 }, { id: 2, label: "Nein", bot: 6, real: 0 }];
  it("adds grown bot votes and real ones, percentages add up to 100", () => {
    const v = pollView("Loibl raus???", opts, T0, at(GROW_MS), 1);
    expect(v.total).toBe(19);
    expect(v.mine).toBe(1);
    expect(v.options.map((o) => o.label)).toEqual(["Ja", "Nein"]);
    expect(v.options.reduce((a, o) => a + o.pct, 0)).toBe(100);
    expect(v.options[0].pct).toBeGreaterThan(v.options[1].pct);
    expect(pollView("Frage", opts, T0, at(0)).total).toBe(1); // only the real votes before the bot votes grow
  });
  it("shows 0% everywhere without votes", () => {
    const v = pollView("Frage", opts.map((o) => ({ ...o, bot: 0, real: 0 })), T0, at(GROW_MS));
    expect(v.total).toBe(0);
    expect(v.options.map((o) => o.pct)).toEqual([0, 0]);
    expect(v.mine).toBeUndefined();
  });
});

describe("parseNewPoll", () => {
  it("needs a question and two answers", () => {
    expect(parseNewPoll({ question: "ab", options: ["Ja", "Nein"] })).toEqual({ error: "Schreib eine Frage." });
    expect(parseNewPoll({ question: "Loibl raus?", options: ["Ja", "  "] })).toEqual({ error: "Mindestens zwei Antworten." });
    expect(parseNewPoll(null)).toEqual({ error: "Ungültige Anfrage." });
  });
  it("trims and keeps at most six answers", () => {
    const p = parseNewPoll({ question: "  Wer spielt? ", options: [" A ", "B", "C", "D", "E", "F", "G", ""] });
    expect(p).toEqual({ question: "Wer spielt?", options: ["A", "B", "C", "D", "E", "F"] });
  });
});

describe("wholePercents", () => {
  it.each([
    [[1, 1, 1], [34, 33, 33]],
    [[2, 1], [67, 33]],
    [[0, 0], [0, 0]],
  ])("%j → %j", (counts, pct) => expect(wholePercents(counts)).toEqual(pct));
});
