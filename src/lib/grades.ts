/** Grades of match reports: 1 (best) to 6, written the German way ("3,5"). */
export const formatGrade = (g: number) => g.toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 2 });

/** Badge colours from very good (deep green) to poor (red), readable on the pitch and on the page. */
export function gradeColor(g: number): { bg: string; fg: string } {
  if (g <= 2) return { bg: "#1f9d55", fg: "#fff" };
  if (g <= 3) return { bg: "#34c759", fg: "#06290f" };
  if (g <= 3.5) return { bg: "#ffd60a", fg: "#3a2c00" };
  if (g <= 4.5) return { bg: "#ff9f0a", fg: "#3a1d00" };
  return { bg: "#ff453a", fg: "#fff" };
}
