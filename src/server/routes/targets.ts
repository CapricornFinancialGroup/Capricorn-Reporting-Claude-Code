// Weekly targets upload (item 1, 2026-07-07) — the first mutating route in this app.
//
//   GET  /api/targets/template   blank .xlsx, generated from the current office roster
//   POST /api/targets/upload     multipart upload, isTargetsAdmin-gated, fails closed
//
// Behind Easy Auth like /api/reporting/* (not Easy-Auth-excluded like the kiosk) — this mutates
// live targets, so it's dashboard-only, never reachable from an unattended kiosk TV.

import ExcelJS from "exceljs";
import type { FastifyInstance } from "fastify";
import type { Config } from "../../config.js";
import { isTargetsAdmin, resolveCsm } from "../../services/auth.js";
import { logger } from "../../services/logger.js";
import { tzToday } from "../../services/reporting/pace.js";
import { uploadTargetsBlob } from "../../services/targets/blob.js";
import { parseTargetsWorkbook } from "../../services/targets/parse.js";
import { buildBlankTemplate } from "../../services/targets/template.js";
import { activateTargets, getLastParsed, getTargetsProvenance } from "../../services/targets/store.js";

export function registerTargetsRoutes(app: FastifyInstance, config: Config): void {
  app.get("/api/targets/template", async (_request, reply) => {
    const buffer = await buildBlankTemplate();
    return reply
      .type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
      .header("content-disposition", 'attachment; filename="capricorn-weekly-targets-template.xlsx"')
      .send(buffer);
  });

  app.post("/api/targets/upload", async (request, reply) => {
    const viewer = resolveCsm(request.headers, config.devUserEmail);
    if (!viewer) {
      return reply.code(401).send({ error: "Not authenticated." });
    }
    if (!isTargetsAdmin(viewer.email, config.targets.adminEmails)) {
      return reply.code(403).send({ error: "Not authorized to upload targets." });
    }
    if (!config.targets.storageAccount) {
      return reply.code(503).send({ error: "Targets storage isn't configured on this environment." });
    }

    const file = await request.file();
    if (!file) {
      return reply.code(400).send({ error: "No file uploaded." });
    }
    const rawBuffer = await file.toBuffer();

    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(rawBuffer as unknown as ExcelJS.Buffer);
    } catch {
      return reply.code(422).send({ error: "Validation failed.", hardErrors: ["Could not read the file — is it a valid .xlsx?"], softWarnings: [] });
    }

    const today = tzToday(new Date(), config.reporting.timeZone);
    const outcome = parseTargetsWorkbook(workbook, getLastParsed(), today);
    if (!outcome.ok || !outcome.data) {
      return reply.code(422).send({ error: "Validation failed.", hardErrors: outcome.hardErrors, softWarnings: outcome.softWarnings });
    }

    const uploadedBy = viewer.email;
    const uploadedAt = new Date().toISOString();
    try {
      // Persist THEN activate — never the other order, so a failed blob write can't leave the UI
      // claiming success while nothing durable happened.
      await uploadTargetsBlob(config.targets.storageAccount, rawBuffer, outcome.data, uploadedBy, uploadedAt);
    } catch (err) {
      logger.error("Targets blob write failed", { err: String(err) });
      return reply.code(502).send({ error: "Upload validated but could not be saved — please try again." });
    }
    activateTargets(outcome.data, uploadedBy, uploadedAt);
    logger.info("Weekly targets activated", { effectiveWeek: outcome.data.effectiveWeek, uploadedBy });

    return reply.send({ ok: true, softWarnings: outcome.softWarnings, provenance: getTargetsProvenance() });
  });
}
