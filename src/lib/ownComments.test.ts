import { describe, expect, it } from "vitest";
import { parseNewComment, senderKey, toThreads } from "./ownComments.ts";

describe("parseNewComment", () => {
  it("cleans name and text", () => {
    expect(parseNewComment({ name: "  Toni \n S ", text: " Feuer frei Torres\u0007\n\n\n\n🔥 " })).toEqual({ name: "Toni S", text: "Feuer frei Torres\n\n🔥" });
  });
  it("needs a name and a text", () => {
    expect(parseNewComment({ name: "A", text: "x" })).toEqual({ error: "Gib einen Namen ein." });
    expect(parseNewComment({ name: "Anna", text: "  " })).toEqual({ error: "Schreib etwas." });
  });
  it("cuts overlong input and checks the parent", () => {
    const c = parseNewComment({ name: "x".repeat(50), text: "y".repeat(2000), parent: 3 });
    expect(c).toMatchObject({ parent: 3 });
    expect("name" in c && c.name.length).toBe(30);
    expect("text" in c && c.text.length).toBe(1000);
    expect(parseNewComment({ name: "Anna", text: "x", parent: "abc" })).toEqual({ error: "Ungültige Anfrage." });
  });
});

describe("toThreads", () => {
  it("nests replies under their comment, newest thread first", () => {
    const rows = [
      { id: 1, parent_id: null, name: "A", body: "eins", created_at: "2026-10-14T20:41:00Z" },
      { id: 2, parent_id: null, name: "B", body: "zwei", created_at: "2026-10-14T20:42:00Z" },
      { id: 3, parent_id: 1, name: "C", body: "antwort", created_at: "2026-10-14T20:43:00Z" },
    ];
    const t = toThreads(rows);
    expect(t.map((c) => c.text)).toEqual(["zwei", "eins"]);
    expect(t[1].replies.map((c) => c.user)).toEqual(["C"]);
  });
});

describe("senderKey", () => {
  it("hashes the sender without keeping the IP", async () => {
    const k = await senderKey("1.2.3.4", "s");
    expect(k).toMatch(/^[0-9a-f]{64}$/);
    expect(k).not.toContain("1.2.3.4");
  });
});
