// Small helpers shared by the API routes (no Worker imports, so tests and the browser bundle can use them too).

/** A personal answer: never cached anywhere. */
export const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "private, no-store" } });

export const forbidden = () => new Response("Forbidden", { status: 403, headers: { "cache-control": "private, no-store" } });

/** The request's JSON body ({} for null), or the 400 to answer with when it isn't JSON. */
export async function readJson<T = unknown>(request: Request): Promise<T | Response> {
  try {
    return ((await request.json()) ?? {}) as T;
  } catch {
    return json({ error: "Ungültige Anfrage." }, 400);
  }
}

/** The subset of Cloudflare's Cache API we use (caches.default). */
export type EdgeCache = {
  match(key: string): Promise<Response | undefined>;
  put(key: string, res: Response): Promise<void>;
};

/** Cloudflare's edge cache; absent outside the Worker runtime. */
export const edgeCache = () => (globalThis as { caches?: { default?: EdgeCache } }).caches?.default;

/** Hands work to the Worker to finish after the response is out (the adapter's locals.cfContext). */
export type Later = (work: Promise<unknown>) => void;

export function later(locals: object): Later {
  const ctx = (locals as { cfContext?: { waitUntil(p: Promise<unknown>): void } }).cfContext;
  return (work) => {
    const quiet = work.catch(() => {});
    ctx?.waitUntil(quiet);
  };
}

