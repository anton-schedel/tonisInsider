// @ts-check
import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import cloudflare from "@astrojs/cloudflare";

export default defineConfig({
  output: "static",
  // Only /mein-team/ and /api/* run on the Worker. No Astro sessions (our session is the Kickbase
  // token cookie) and no image service, so the adapter adds no KV namespace or Images binding.
  // Static pages prerender in Node because they read the scraped data from store/ via node:fs.
  adapter: cloudflare({ imageService: "passthrough", prerenderEnvironment: "node" }),
  session: false,
  trailingSlash: "always",
  build: { format: "directory" },
  // Load pages in the background as links scroll into view, so taps feel instant.
  prefetch: { prefetchAll: true, defaultStrategy: "viewport" },
  vite: { plugins: [tailwindcss()] },
});
