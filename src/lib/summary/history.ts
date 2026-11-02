import { HISTORY_VERSION, type KbHistory } from "../../../scraper/kbHistory.ts";

/**
 * The Kickbase history the scraper publishes (/data/kb-history.json), parsed once per build: undefined when the
 * deploy has none yet or older code wrote it.
 */
export async function readKbHistory(
  fetchAsset: (path: string) => Promise<Response>, build: string, cache: { entry?: { build: string; data: unknown } },
): Promise<KbHistory | undefined> {
  if (cache.entry?.build === build) return cache.entry.data as KbHistory | undefined;
  let data: KbHistory | undefined;
  try {
    const res = await fetchAsset("/data/kb-history.json");
    const h = res.ok ? ((await res.json()) as KbHistory) : undefined;
    data = h?.version === HISTORY_VERSION ? h : undefined;
  } catch {
    // Not cached: the next request tries again.
    return undefined;
  }
  cache.entry = { build, data };
  return data;
}
