// Weekly targets upload (item 1, 2026-07-07) — the first mutating route in this app.
//
//   GET  /api/targets/template          blank .xlsx, generated from the current office roster
//   POST /api/targets/upload            manual two-sheet template, isTargetsAdmin-gated
//   POST /api/targets/import-datarails  Capricorn's real Datarails export, Applications+Sales only
//
// Behind Easy Auth like /api/reporting/* (not Easy-Auth-excluded like the kiosk) — this mutates
// live targets, so it's dashboard-only, never reachable from an unattended kiosk TV.

import ExcelJS from "exceljs";
import type { FastifyInstance } from "fastify";
import type { Config } from "../../config.js";
import { UNASSIGNED } from "../../domain/offices.js";
import { isTargetsAdmin, resolveCsm } from "../../services/auth.js";
import { logger } from "../../services/logger.js";
import { adviserRoster } from "../../services/reporting/advisers.js";
import { tzToday } from "../../services/reporting/pace.js";
import { run } from "../../services/reporting/query.js";
import { shiftDays } from "../../services/reporting/trends.js";
import { uploadTargetsBlob } from "../../services/targets/blob.js";
import { parseDatarailsWorkbook, type AdviserRosterEntry } from "../../services/targets/parseDatarails.js";
import { parseTargetsWorkbook, runSoftChecks, type ParsedTargets } from "../../services/targets/parse.js";
import { buildBlankTemplate } from "../../services/targets/template.js";
import {
  activateTargets,
  getCurrentAsParsedTargets,
  getLastParsed,
  getTargetsProvenance,
} from "../../services/targets/store.js";

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

  app.post("/api/targets/import-datarails", async (request, reply) => {
    const viewer = resolveCsm(request.headers, config.devUserEmail);
    if (!viewer) {
      return reply.code(401).send({ error: "Not authenticated." });
    }
    if (!isTargetsAdmin(viewer.email, config.targets.adminEmails)) {
      return reply.code(403).send({ error: "Not authorized to import targets." });
    }
    if (!config.targets.storageAccount) {
      return reply.code(503).send({ error: "Targets storage isn't configured on this environment." });
    }

    let rawBuffer: Buffer | undefined;
    let weekSaturday: string | undefined;
    for await (const part of request.parts()) {
      if (part.type === "file") rawBuffer = await part.toBuffer();
      else if (part.fieldname === "week") weekSaturday = String(part.value).trim();
    }
    if (!rawBuffer) {
      return reply.code(400).send({ error: "No file uploaded." });
    }
    if (!weekSaturday || !/^\d{4}-\d{2}-\d{2}$/.test(weekSaturday)) {
      return reply.code(400).send({ error: "A valid week (YYYY-MM-DD, the workbook's Saturday column) is required." });
    }

    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(rawBuffer as unknown as ExcelJS.Buffer);
    } catch {
      return reply.code(422).send({ error: "Validation failed.", hardErrors: ["Could not read the file — is it a valid .xlsx?"], softWarnings: [] });
    }

    const roster = await run<AdviserRosterEntry>({ server: config.fabric.endpoint, database: config.fabric.database }, adviserRoster());
    const outcome = parseDatarailsWorkbook(workbook, weekSaturday, roster);
    if (!outcome.ok || !outcome.offices) {
      return reply.code(422).send({ error: "Validation failed.", hardErrors: outcome.hardErrors, softWarnings: outcome.softWarnings });
    }

    const today = tzToday(new Date(), config.reporting.timeZone);
    const base = getCurrentAsParsedTargets(today);
    const merged: ParsedTargets = {
      effectiveWeek: shiftDays(weekSaturday, 2), // Saturday → the Monday that starts its working week
      revenueWeekly: base.revenueWeekly,
      offices: Object.fromEntries(
        Object.entries(base.offices).map(([office, values]) => [
          office,
          {
            ...values,
            applications: outcome.applicationsAvailable ? (outcome.offices![office]?.applications ?? 0) : values.applications,
            sales: outcome.salesAvailable ? (outcome.offices![office]?.sales ?? 0) : values.sales,
            // Protection: the weekly pledge is BOTH the sales target and the referral target (Kyle
            // 2026-07-14 — the mortgage adviser "pledges" a referral to the protection adviser, so
            // referral target == sales target). Mirror the same pledge into referrals; actual
            // referrals-made comes from the lake, so this is what the target-vs-actual % paces to.
            referrals: outcome.salesAvailable ? (outcome.offices![office]?.sales ?? 0) : values.referrals,
          },
        ]),
      ),
    };

    const softWarnings = [...outcome.softWarnings, ...runSoftChecks(merged, getLastParsed(), today)];
    const unassigned = outcome.offices[UNASSIGNED];
    if (unassigned && (unassigned.applications > 0 || unassigned.sales > 0)) {
      softWarnings.push(
        `${unassigned.applications} Applications / ${unassigned.sales} Sales came from advisers with no office mapping (domain/offices.ts) and were excluded from every office's total.`,
      );
    }
    if (outcome.unmatchedAdvisers.length > 0) {
      softWarnings.push(`${outcome.unmatchedAdvisers.length} adviser name(s) in the workbook didn't match a known adviser and were excluded: ${outcome.unmatchedAdvisers.join(", ")}.`);
    }

    const imported = [outcome.applicationsAvailable && "Applications", outcome.salesAvailable && "Sales & Referrals"].filter(Boolean).join(" & ");
    const unchanged = [!outcome.applicationsAvailable && "Applications", !outcome.salesAvailable && "Sales & Referrals", "Leads", "Revenue"].filter(Boolean).join("/");
    const uploadedBy = viewer.email;
    const uploadedAt = new Date().toISOString();
    const note = `${imported} from Datarails import (week of ${weekSaturday}); ${unchanged} unchanged.`;
    try {
      await uploadTargetsBlob(config.targets.storageAccount, rawBuffer, merged, uploadedBy, uploadedAt);
    } catch (err) {
      logger.error("Targets blob write failed", { err: String(err) });
      return reply.code(502).send({ error: "Import validated but could not be saved — please try again." });
    }
    activateTargets(merged, uploadedBy, uploadedAt, note);
    logger.info("Datarails targets import activated", { effectiveWeek: merged.effectiveWeek, uploadedBy, unmatched: outcome.unmatchedAdvisers.length });

    return reply.send({ ok: true, softWarnings, unmatchedAdvisers: outcome.unmatchedAdvisers, provenance: getTargetsProvenance() });
  });
}
