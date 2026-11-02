import { describe, expect, it } from "vitest";
import { groupOf } from "./groups.ts";

describe("groupOf", () => {
  it("puts each Kickbase event type into its group", () => {
    expect(groupOf(4216)).toBe("attack"); // Torschuss (aufs Tor)
    expect(groupOf(4231)).toBe("duel"); // Gewonnener Zweikampf
    expect(groupOf(4240)).toBe("mistake"); // Ballverlust
    expect(groupOf(4237)).toBe("time"); // Startelf
    expect(groupOf("4201")).toBe("pass"); // Pass vorderes Drittel
    expect(groupOf(999999)).toBe("other");
  });
});
