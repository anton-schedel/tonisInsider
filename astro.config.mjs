// @ts-check
import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  output: "static",
  trailingSlash: "always",
  build: { format: "directory" },
  // Load pages in the background as links scroll into view, so taps feel instant.
  prefetch: { prefetchAll: true, defaultStrategy: "viewport" },
  vite: { plugins: [tailwindcss()] },
});
