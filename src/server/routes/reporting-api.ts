// JSON reporting API behind Easy Auth — the interactive dashboard's data source.
//
//   GET /api/reporting/:dataset?from=&to=
//
// Easy Auth (the platform) has already enforced authentication for everything except the excluded
// kiosk paths; we additionally resolve the viewer identity so local dev (DEV_USER_EMAIL) works and
// a missing principal fails closed. The shared serveDataset() is reused by the kiosk routes.

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Config } from "../../config.js";
import { isTargetsAdmin, resolveCsm, type CsmIdentity } from "../../services/auth.js";
import { parseFilters } from "../../services/reporting/filters.js";
import { getDataset, isDatasetName } from "../../services/reporting/datasets.js";
import { logger } from "../../services/logger.js";

/** Resolve + run a dataset from the request query, sending the standard JSON envelope. `viewer` is
 *  only known on the Easy-Auth dashboard route (null from the kiosk, which has no signed-in
 *  identity) — used solely to stamp `isTargetsAdmin` onto the `meta` payload so the frontend can
 *  hide the Targets/Glossary tabs from non-admins. Every other dataset ignores it. */
export async function serveDataset(
  config: Config,
  name: string,
  request: FastifyRequest,
  reply: FastifyReply,
  viewer: CsmIdentity | null = null,
): Promise<FastifyReply> {
  if (!isDatasetName(name)) {
    return reply.code(404).send({ error: `Unknown dataset: ${name}` });
  }
  try {
    const filters = parseFilters(request.query as Record<string, unknown>);
    const data = await getDataset(name, config, filters);
    if (name === "meta") {
      (data as { isTargetsAdmin: boolean }).isTargetsAdmin = viewer ? isTargetsAdmin(viewer.email, config.targets.adminEmails) : false;
    }
    return reply.send({ dataset: name, generatedAt: new Date().toISOString(), data });
  } catch (err) {
    logger.error("Reporting dataset failed", { dataset: name, err: String(err) });
    return reply.code(500).send({ error: "Dataset query failed", detail: String((err as Error)?.message ?? err) });
  }
}

export function registerReportingRoutes(app: FastifyInstance, config: Config): void {
  app.get<{ Params: { dataset: string } }>("/api/reporting/:dataset", async (request, reply) => {
    const viewer = resolveCsm(request.headers, config.devUserEmail);
    if (!viewer) {
      return reply.code(401).send({ error: "Not authenticated." });
    }
    return serveDataset(config, request.params.dataset, request, reply, viewer);
  });
}
