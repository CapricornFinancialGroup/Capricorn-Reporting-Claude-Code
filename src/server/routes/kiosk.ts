// Token-gated kiosk data API for the office wall displays.
//
//   GET /api/kiosk/:dataset?k=<token>&from=&to=&...   (or header `x-kiosk-token`)
//
// These paths are EXCLUDED from Easy Auth in the Bicep (authsettingsV2.excludedPaths) so a TV needs
// no interactive login; the shared secret REPORTING_KIOSK_TOKEN gates them instead. The kiosk is
// DISABLED (401) when no token is configured, so the endpoint is never open by accident. Data logic
// is the same serveDataset() the Easy-Auth dashboard uses.

import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Config } from "../../config.js";
import { serveDataset } from "./reporting-api.js";

function kioskTokenOk(config: Config, request: FastifyRequest): boolean {
  if (!config.reporting.kioskToken) return false; // unconfigured = disabled, never open
  const q = (request.query as { k?: string } | undefined)?.k;
  const header = request.headers["x-kiosk-token"];
  const provided = q ?? (Array.isArray(header) ? header[0] : header) ?? "";
  return provided === config.reporting.kioskToken;
}

export function registerKioskRoutes(app: FastifyInstance, config: Config): void {
  // Single exact path `/api/kiosk?dataset=<name>` — Easy Auth excludedPaths is EXACT-match only, so
  // the dataset goes in the query string (one excludable path) rather than the URL path.
  app.get<{ Querystring: { dataset?: string } }>("/api/kiosk", async (request, reply) => {
    if (!kioskTokenOk(config, request)) {
      return reply.code(401).send({ error: "Invalid or missing kiosk token." });
    }
    return serveDataset(config, request.query.dataset ?? "", request, reply);
  });
}
