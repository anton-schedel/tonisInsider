import type { NewsType } from "../../scraper/types.ts";

/** The colours of a pill (.pill with .tone-*, global.css): news types, start chances, statuses. */
export type Tone = "red" | "yellow" | "green" | "grey";
/** The pill's colour class; no tone is grey. */
export const toneClass = (tone: Tone | undefined) => `tone-${tone ?? "grey"}`;

/** Label and colour of a news type (StatusPill, player card); "sonstiges" has none. */
export const NEWS_TYPE: Record<NewsType, { label: string; tone: Tone } | undefined> = {
  verletzung: { label: "Verletzung", tone: "red" },
  angeschlagen: { label: "Angeschlagen", tone: "yellow" },
  aufbautraining: { label: "Aufbautraining", tone: "green" },
  fit: { label: "Fit", tone: "green" },
  sonstiges: undefined,
};
