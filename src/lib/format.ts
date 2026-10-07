const TZ = "Europe/Berlin";

const dayKeyFmt = new Intl.DateTimeFormat("de-DE", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const timeFmt = new Intl.DateTimeFormat("de-DE", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
const dayLabelFmt = new Intl.DateTimeFormat("de-DE", { timeZone: TZ, weekday: "short", day: "2-digit", month: "2-digit" });
const kickoffFmt = new Intl.DateTimeFormat("de-DE", { timeZone: TZ, weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const fullFmt = new Intl.DateTimeFormat("de-DE", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

export const time = (iso: string) => timeFmt.format(new Date(iso));
export const dayKey = (iso: string) => dayKeyFmt.format(new Date(iso));
export const kickoff = (iso: string) => kickoffFmt.format(new Date(iso)).replace(",", " ·") + " Uhr";
export const fullDate = (iso: string) => fullFmt.format(new Date(iso)).replace(",", " ·");

/** "Heute · Mi., 07.10." / "Gestern · …" / "Mo., 05.10." relative to the build time. */
export function dayLabel(iso: string, now: Date): string {
  const label = dayLabelFmt.format(new Date(iso));
  const key = dayKey(iso);
  if (key === dayKey(now.toISOString())) return `Heute · ${label}`;
  if (key === dayKey(new Date(now.getTime() - 86_400_000).toISOString())) return `Gestern · ${label}`;
  return label;
}

export function initials(name: string): string {
  const parts = name.replace(/\./g, "").split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}
