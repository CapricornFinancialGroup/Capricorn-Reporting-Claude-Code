// Which commit is actually serving this request.
//
// Written by scripts/deployment/stamp-build.mjs at build time into dist/build-info.json, read once at
// startup. Extracted from server/routes/health.ts on 2026-09-02 because three things now need it:
// /healthz (is the fix live?), the SPA shell (which build is this TAB running?) and the `meta`
// dataset (which build is the SERVER on?) — and the last two are what let a wall reload itself.
//
// Lives at the src root rather than under server/ because services/reporting reads it too, and a
// service reaching up into the server layer is the wrong direction.
//
// Reported so "is the fix live?" is answerable without guessing — the question nobody could answer on
// 2026-07-30, when Capricorn was looking at a build two days older than the one being described to
// them. `unknown` in dev (tsx runs from src/, so there is no dist/) and that is reported honestly
// rather than faked.

import { readFileSync } from "node:fs";

export interface BuildInfo {
  sha: string | null;
  shortSha: string | null;
  committedAt: string | null;
  subject: string | null;
  branch: string | null;
  dirty: boolean;
  builtAt: string | null;
}

function read(): BuildInfo | { status: "unknown" } {
  try {
    // dist/build-info.js → ./build-info.json = dist/build-info.json
    return JSON.parse(readFileSync(new URL("./build-info.json", import.meta.url), "utf8")) as BuildInfo;
  } catch {
    return { status: "unknown" };
  }
}

export const buildInfo = read();

/** The serving commit's SHA, or null when unstamped (dev). The wall's staleness check compares this
 *  against the one baked into the page it is running, so it must be null rather than a placeholder —
 *  a fake value would make a dev tab reload itself forever. */
export const buildSha: string | null =
  "sha" in buildInfo && typeof buildInfo.sha === "string" ? buildInfo.sha : null;
