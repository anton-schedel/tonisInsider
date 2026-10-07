// The Worker bindings this site uses (see wrangler.jsonc and `wrangler secret put CREDENTIALS_KEY`).
declare module "cloudflare:workers" {
  export const env: {
    /** Static assets of this site (dist/client). */
    ASSETS: { fetch(input: Request | URL | string): Promise<Response> };
    /** 32 random bytes, base64. Encrypts the "stay logged in" cookie. Missing → weekly login instead. */
    CREDENTIALS_KEY?: string;
  };
}
