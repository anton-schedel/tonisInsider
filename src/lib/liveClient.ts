import { LIVE_URL, parseLive, type LiveMatch } from "./live.ts";

/**
 * Keeps the live scores of the current matchday in sessionStorage, on every page (News too), so match cards
 * already have them when they're shown. Polls every 30 s while one of the matchday's matches runs (from kickoff
 * for 3 h), only while the tab is visible; window.__applyLive (Base.astro) draws them.
 */
const POLL_MS = 30_000;
const AFTER_MS = 3 * 3600_000;
type Stored = { at: number; matches: LiveMatch[] };

declare global {
  interface Window { __applyLive?: (doc: Document) => void }
}

function stored(): Stored | undefined {
  try {
    const s = JSON.parse(sessionStorage.getItem("live") ?? "null") as Stored | null;
    return s && Array.isArray(s.matches) ? s : undefined;
  } catch {
    return undefined;
  }
}

let timer = 0;

async function tick() {
  clearTimeout(timer);
  const kickoffs = (document.documentElement.dataset.kickoffs ?? "").split(",").map(Date.parse).filter(Boolean);
  const now = Date.now();
  if (!kickoffs.some((k) => k <= now) || document.visibilityState !== "visible") return;
  const running = kickoffs.some((k) => k <= now && now < k + AFTER_MS);
  const cache = stored();
  // Between matches one fetch is enough (the final scores of those that ended since the last one).
  const lastEnd = Math.max(0, ...kickoffs.map((k) => k + AFTER_MS).filter((end) => end <= now));
  if (!cache || cache.at < lastEnd || (running && now - cache.at >= POLL_MS - 5000)) {
    try {
      const res = await fetch(LIVE_URL, { cache: "no-store" });
      if (res.ok) {
        const matches = parseLive(await res.json());
        try { sessionStorage.setItem("live", JSON.stringify({ at: Date.now(), matches })); } catch {}
        window.__applyLive?.(document);
      }
    } catch {
      // Unreachable: cards keep what they show; the next tick tries again.
    }
  }
  if (running) timer = window.setTimeout(tick, POLL_MS);
}

export function startLive() {
  document.addEventListener("astro:page-load", () => void tick());
  document.addEventListener("visibilitychange", () => void tick());
}
