// Health probes for App Service / pipeline smoke checks.

import type { FastifyInstance } from "fastify";
import type { Config } from "../../config.js";
import { run } from "../../services/reporting/query.js";

const startedAt = Date.now();

export function registerHealthRoutes(app: FastifyInstance, config: Config): void {
  // Liveness: process is up.
  app.get("/healthz", async () => ({
    status: "ok",
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
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
