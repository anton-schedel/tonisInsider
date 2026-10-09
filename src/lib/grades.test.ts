import { describe, expect, it } from "vitest";
import { formatGrade, gradeColor } from "./grades.ts";

describe("grades", () => {
  it("writes grades with a comma and at least one decimal", () => {
    expect(formatGrade(3)).toBe("3,0");
    expect(formatGrade(4.5)).toBe("4,5");
    expect(formatGrade(3.43)).toBe("3,43");
  });
  it("colours from green to red", () => {
    expect(gradeColor(1.5).bg).toBe("#1f9d55");
    expect(gradeColor(3.5).bg).toBe("#ffd60a");
    expect(gradeColor(5).bg).toBe("#ff453a");
  });
});
