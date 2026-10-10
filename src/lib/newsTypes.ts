import type { NewsType } from "../../scraper/types.ts";

/** Label and colour of a news type (StatusPill, player card); "sonstiges" has none. */
export const NEWS_TYPE: Record<NewsType, { label: string; tone: "red" | "yellow" | "green" } | undefined> = {
  verletzung: { label: "Verletzung", tone: "red" },
  angeschlagen: { label: "Angeschlagen", tone: "yellow" },
  aufbautraining: { label: "Aufbautraining", tone: "green" },
  fit: { label: "Fit", tone: "green" },
  sonstiges: undefined,
};
