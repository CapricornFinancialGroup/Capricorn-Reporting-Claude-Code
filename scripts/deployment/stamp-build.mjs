#!/usr/bin/env node
// Writes dist/build-info.json so the RUNNING app can say which commit it is.
//
// Why this exists: on 2026-07-29 a set of metric fixes was described to Capricorn as live while it
// was still sitting uncommitted on a laptop. Kyle looked at the board the next morning, saw the old
// numbers, and reasonably concluded nothing had been done. There was no way to ask the deployed app
// what it was running — so nobody could tell the difference between "not deployed" and "deployed but
// still wrong". /healthz now answers that.
//
// dist/ is gitignored, so this file is a build artifact, never committed. Absent in `npm run dev`
// (tsx runs from src/) — the route reports "unknown" rather than inventing a value.

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const out = resolve(root, "dist/build-info.json");

/** Best-effort git lookup — a stamp is a convenience, never a reason to fail a build. */
function git(...args) {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

const sha = git("rev-parse", "HEAD");
// A dirty tree means the deployed bundle does not correspond to any commit. Surfacing that is the
// whole point: "deployed from a dirty tree" is exactly the state that caused the confusion above.
const dirty = git("status", "--porcelain") ? true : false;

const info = {
  sha,
  shortSha: sha ? sha.slice(0, 7) : null,
  committedAt: git("show", "-s", "--format=%cI", "HEAD"),
  subject: git("show", "-s", "--format=%s", "HEAD"),
  branch: git("rev-parse", "--abbrev-ref", "HEAD"),
  dirty,
  builtAt: new Date().toISOString(),
};

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(info, null, 2)}\n`);
console.log(`build stamp: ${info.shortSha ?? "unknown"}${dirty ? " (DIRTY TREE)" : ""} on ${info.branch ?? "?"} at ${info.builtAt}`);
