import { describe, it, expect } from "vitest";
import { isSameOrigin } from "./session.ts";

const req = (origin?: string) =>
  new Request("https://ti.example/api/login/", { method: "POST", headers: origin ? { origin } : {} });

describe("isSameOrigin (CSRF guard)", () => {
  it("accepts our own origin", () => expect(isSameOrigin(req("https://ti.example"))).toBe(true));
  it("rejects a foreign origin", () => expect(isSameOrigin(req("https://evil.example"))).toBe(false));
  it("rejects a missing or null origin", () => {
    expect(isSameOrigin(req())).toBe(false);
    expect(isSameOrigin(req("null"))).toBe(false);
  });
});
