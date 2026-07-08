// Builds the Fastify instance and registers all routes. Kept separate from index.ts so tests can
// build an app and call .inject() without binding a port.

import Fastify, { type FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import type { Config } from "../config.js";
import { logger } from "../services/logger.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerReportingRoutes } from "./routes/reporting-api.js";
import { registerKioskRoutes } from "./routes/kiosk.js";
import { registerTargetsRoutes } from "./routes/targets.js";
import { registerSpaRoutes } from "./static.js";

export async function buildApp(config: Config): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, trustProxy: true });

  app.addHook("onRequest", async (req) => {
    if (req.url === "/healthz") return; // skip warmup-probe noise
    logger.info("inbound", { method: req.method, url: req.url, ip: req.ip });
  });

  // The weekly targets upload is the first (and only) multipart route — a ~29-number workbook is
  // tiny, so 5MB is generous headroom, not a real limit.
  await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024 } });

  registerHealthRoutes(app, config);
  registerReportingRoutes(app, config);
  registerKioskRoutes(app, config);
  registerTargetsRoutes(app, config);
  registerSpaRoutes(app);

  return app;
}
