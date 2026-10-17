// The Worker bindings this site uses (see wrangler.jsonc and `wrangler secret put CREDENTIALS_KEY`).
declare module "cloudflare:workers" {
  export const env: {
    /** Static assets of this site (dist/client). */
    ASSETS: { fetch(input: Request | URL | string): Promise<Response> };
    /** 32 random bytes, base64. Encrypts the "stay logged in" cookie. Missing → weekly login instead. */
    CREDENTIALS_KEY?: string;
    /** Kickbase account the server uses for public live points (club pages); `wrangler secret put`. */
    KICKBASE_EMAIL?: string;
    KICKBASE_PASSWORD?: string;
    /** Comments on our own posts (D1, see migrations/). */
    COMMENTS?: D1;
  };
  /** The part of Cloudflare's D1 API used here. */
  export type D1 = {
    prepare(sql: string): {
      bind(...values: unknown[]): {
        all<T>(): Promise<{ results: T[] }>;
        first<T>(): Promise<T | null>;
        run(): Promise<{ meta: { last_row_id: number } }>;
      };
    };
  };
}
