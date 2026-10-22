import { describe, expect, it } from "vitest";
import { COACH_DAYS, isCoach, passwordMatches, signCoach } from "./coachAuth.ts";

const KEY = "c2VjcmV0LWtleS1mb3ItdGVzdHMtb25seS0zMmJ5dGVz";
const NOW = Date.parse("2026-10-24T12:00:00Z");

describe("coach cookie", () => {
  it("is valid until it runs out", async () => {
    const v = await signCoach(KEY, NOW);
    expect(await isCoach(v, KEY, NOW + 1000)).toBe(true);
    expect(await isCoach(v, KEY, NOW + COACH_DAYS * 86_400_000 + 1)).toBe(false);
  });
  it("can't be extended or forged", async () => {
    const v = await signCoach(KEY, NOW);
    const [, mac] = v.split(".");
    expect(await isCoach(`${NOW + 999 * 86_400_000}.${mac}`, KEY, NOW)).toBe(false);
    expect(await isCoach(v, "b3RoZXIta2V5", NOW)).toBe(false);
    expect(await isCoach("junk", KEY, NOW)).toBe(false);
    expect(await isCoach(undefined, KEY, NOW)).toBe(false);
    expect(await isCoach(v, undefined, NOW)).toBe(false);
  });
});

describe("passwordMatches", () => {
  it("compares the whole password", () => {
    expect(passwordMatches("Schnösel-2026", "Schnösel-2026")).toBe(true);
    expect(passwordMatches("Schnösel-202", "Schnösel-2026")).toBe(false);
    expect(passwordMatches("", "")).toBe(false);
    expect(passwordMatches("x", undefined)).toBe(false);
  });
});
