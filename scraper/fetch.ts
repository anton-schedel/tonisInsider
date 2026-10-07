export class HttpError extends Error {
  constructor(readonly status: number, url: string) {
    super(`HTTP ${status} for ${url}`);
  }
}

export type Fetcher = {
  text(url: string): Promise<string>;
  binary(url: string): Promise<Uint8Array>;
};

export const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Polite HTTP client: one request at a time, a pause between requests, one retry, timeout. */
export function createFetcher(opts: { delayMs?: number; timeoutMs?: number } = {}): Fetcher {
  const delayMs = opts.delayMs ?? 1000;
  const timeoutMs = opts.timeoutMs ?? 15000;
  let last = 0;

  async function get(url: string): Promise<Response> {
    for (let attempt = 1; ; attempt++) {
      const wait = last + delayMs - Date.now();
      if (wait > 0) await sleep(wait);
      last = Date.now();
      try {
        const res = await fetch(url, {
          headers: { "user-agent": USER_AGENT, "accept-language": "de-DE,de;q=0.9" },
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) throw new HttpError(res.status, url);
        return res;
      } catch (err) {
        if (attempt >= 2 || (err instanceof HttpError && err.status === 404)) throw err;
        await sleep(delayMs * 3);
      }
    }
  }

  return {
    async text(url) { return (await get(url)).text(); },
    async binary(url) { return new Uint8Array(await (await get(url)).arrayBuffer()); },
  };
}
