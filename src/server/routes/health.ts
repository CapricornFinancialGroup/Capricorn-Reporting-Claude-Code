// Health probes for App Service / pipeline smoke checks.

import { readFileSync } from "node:fs";
import type { FastifyInstance } from "fastify";
import type { Config } from "../../config.js";
import { run } from "../../services/reporting/query.js";

const startedAt = Date.now();

interface BuildInfo {
  sha: string | null;
  shortSha: string | null;
  committedAt: string | null;
  subject: string | null;
  branch: string | null;
  dirty: boolean;
  builtAt: string | null;
}

/** Which commit is actually serving this request.
 *
 *  Written by scripts/deployment/stamp-build.mjs at build time into dist/build-info.json, which sits
 *  two levels up from this compiled module (dist/server/routes/health.js). Read once at startup.
 *
 *  Reported so "is the fix live?" is answerable without guessing — the question nobody could answer on
 *  2026-07-30, when Capricorn was looking at a build two days older than the one being described to
 *  them. `unknown` in dev (tsx runs from src/, so there is no dist/) and that is reported honestly
 *  rather than faked. */
function readBuildInfo(): BuildInfo | { status: "unknown" } {
  try {
    const path = new URL("../../build-info.json", import.meta.url);
    return JSON.parse(readFileSync(path, "utf8")) as BuildInfo;
  } catch {
    return { status: "unknown" };
  }
}

const buildInfo = readBuildInfo();

export function registerHealthRoutes(app: FastifyInstance, config: Config): void {
  // Liveness: process is up, and WHICH BUILD is up.
  app.get("/healthz", async () => ({
    status: "ok",
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    build: buildInfo,
  }));

  // Lake readiness: proves the identity (managed identity in prod, az-cli locally) can reach the
  // Fabric SQL endpoint. This is the deployment gate — run it BEFORE pointing any TV at the app.
  app.get("/healthz/lake", async (_req, reply) => {
    try {
      const rows = await run<{ ok: number }>(
        { server: config.fabric.endpoint, database: config.fabric.database },
        { text: "SELECT 1 AS ok", params: [] },
        { retries: 0 },
      );
      return reply.send({ status: "ok", lake: config.fabric.database, ok: rows[0]?.ok === 1 });
    } catch (err) {
      return reply.code(503).send({
        status: "unreachable",
        lake: config.fabric.database,
        detail: String((err as Error)?.message ?? err),
      });
    }
  });
}
