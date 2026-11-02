import { env } from "cloudflare:workers";
import type { KbHistory } from "../../scraper/kbHistory.ts";
import { BUILD_ID } from "./build.ts";
import { readKbHistory } from "./summary/history.ts";

const g = globalThis as unknown as { __kbHistory?: { entry?: { build: string; data: unknown } } };

/** Every player's Kickbase season history from the static assets, read once per Worker isolate and build. */
export const loadKbHistory = (url: URL): Promise<KbHistory | undefined> =>
  readKbHistory((path) => env.ASSETS.fetch(new URL(path, url)), BUILD_ID, (g.__kbHistory ??= {}));
