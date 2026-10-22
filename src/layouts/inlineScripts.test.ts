import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Inline scripts ship as written (no bundler, no typecheck): a syntax error silently kills the whole script,
// e.g. the theme switch and the tab bar. Every one must at least parse.
const root = join(import.meta.dirname, "..");
const files = ["layouts", "components", "pages", "pages/vereine"].flatMap((dir) =>
  readdirSync(join(root, dir)).filter((f) => f.endsWith(".astro")).map((f) => join(root, dir, f)),
);

describe("inline scripts", () => {
  for (const file of files) {
    const scripts = [...readFileSync(file, "utf8").matchAll(/<script is:inline>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    if (!scripts.length) continue;
    it(`parse in ${file.slice(root.length + 1)}`, () => {
      for (const code of scripts) expect(() => new Function(code)).not.toThrow();
    });
  }
});
