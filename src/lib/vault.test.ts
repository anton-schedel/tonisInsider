import { describe, it, expect } from "vitest";
import { seal, unseal } from "./vault.ts";

const KEY = Buffer.alloc(32, 7).toString("base64");
const OTHER = Buffer.alloc(32, 9).toString("base64");

describe("vault (AES-GCM)", () => {
  it("round-trips a secret and never contains the plaintext", async () => {
    const sealed = await seal("geheim123", KEY);
    expect(sealed).not.toContain("geheim");
    expect(await unseal(sealed, KEY)).toBe("geheim123");
  });
  it("uses a fresh IV each time", async () => {
    expect(await seal("x", KEY)).not.toBe(await seal("x", KEY));
  });
  it("returns undefined for a wrong key, tampering or garbage", async () => {
    const sealed = await seal("geheim123", KEY);
    expect(await unseal(sealed, OTHER)).toBeUndefined();
    expect(await unseal(sealed.slice(0, -2) + (sealed.endsWith("A") ? "BB" : "AA"), KEY)).toBeUndefined();
    expect(await unseal("nonsense", KEY)).toBeUndefined();
  });
  it("rejects keys that are not 32 bytes", async () => {
    await expect(seal("x", "c2hvcnQ=")).rejects.toThrow();
  });
});
