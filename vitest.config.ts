import { configDefaults, defineConfig } from "vitest/config";

// `npm test` is the gate in scripts/deployment/deploy-manual.sh, so what it collects decides what a
// deploy is allowed to ship. Vitest's default glob is repo-wide, and this repo keeps its parallel-work
// worktrees INSIDE itself at .claude/worktrees/ (see .gitignore) — each a full checkout of another
// branch. Unexcluded, a 17-file run became 46 files, 29 of them other branches' tests: a deploy of
// THIS branch could be blocked by a failure in code it does not contain, and "533 passed" said nothing
// about the 533 belonging to the thing being deployed.
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, "**/.claude/worktrees/**"],
  },
});
