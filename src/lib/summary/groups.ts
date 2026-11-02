import table from "./eventGroups.json";

/** What a Kickbase event type is about (scripts/event-groups.mjs sorts the 600+ types by their German names). */
export type Group = "goals" | "attack" | "pass" | "duel" | "defence" | "cleansheet" | "keeper" | "time" | "mistake" | "team" | "other";

const GROUPS = table as Record<string, Group>;

export const groupOf = (eti: number | string): Group => GROUPS[String(eti)] ?? "other";

/** As the sentences say it: "die meisten aus {label}". */
export const GROUP_LABEL: Record<Group, string> = {
  goals: "Toren und Vorlagen",
  attack: "Offensivaktionen",
  pass: "Pässen",
  duel: "Zweikämpfen",
  defence: "Defensivaktionen",
  cleansheet: "dem Zu-Null-Bonus",
  keeper: "Torwartaktionen",
  time: "Einsatzzeit",
  mistake: "Fehlern",
  team: "Mannschaftserfolg",
  other: "Sonstigem",
};
