import { configDefaults, defineConfig } from "vitest/config";

// Agents' git worktrees live under .claude/; their copies of the tests aren't ours to run.
export default defineConfig({ test: { exclude: [...configDefaults.exclude, ".claude/**"] } });
