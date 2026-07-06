// Builds the Fastify instance and registers all routes. Kept separate from index.ts so tests can
// build an app and call .inject() without binding a port.

import Fastify, { type FastifyInstance } from "fastify";
import type { Config } from "../config.js";
import { logger } from "../services/logger.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerReportingRoutes } from "./routes/reporting-api.js";
import { registerKioskRoutes } from "./routes/kiosk.js";
import { registerSpaRoutes } from "./static.js";

export async function buildApp(config: Config): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, trustProxy: true });

  app.addHook("onRequest", async (req) => {
    if (req.url === "/healthz") return; // skip warmup-probe noise
    logger.info("inbound", { method: req.method, url: req.url, ip: req.ip });
  });

  registerHealthRoutes(app, config);
  registerReportingRoutes(app, config);
  registerKioskRoutes(app, config);
  registerSpaRoutes(app);

  return app;
}
