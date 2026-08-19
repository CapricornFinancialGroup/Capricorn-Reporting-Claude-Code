// Weekly targets upload (item 1, 2026-07-07) — the first mutating route in this app.
//
//   GET  /api/targets/template          blank .xlsx, generated from the current office roster
//   POST /api/targets/upload            manual two-sheet template, isTargetsAdmin-gated
//   POST /api/targets/import-datarails  Capricorn's real Datarails export, Applications+Sales only
//   POST /api/targets/import-written    Arman's two Weekly Written Targets files → Revenue target
//                                        (Mortgage + Insurance written £, business-wide)
//
// Behind Easy Auth like /api/reporting/* (not Easy-Auth-excluded like the kiosk) — this mutates
// live targets, so it's dashboard-only, never reachable from an unattended kiosk TV.
//
// WEEK_START — `effectiveWeek` is the SATURDAY the admin picked, stored verbatim.
// It used to be shifted forward two days ("Saturday → the Monday that starts its working week"),
// a leftover from when the board ran a Mon–Fri week. Saturday has been a real trading day since
// 2026-08-04, so the shift left the Targets tab reporting a week start the board itself does not
// use: Kyle uploaded for Saturday 15 Aug, the page said "Effective week 2026-08-17", and he could
// not tell whether his file had been captured at all ("I have uploaded targets for the week
// (Saturday 15th Aug) but nothing has updated?", 2026-08-18). Echo back exactly what was chosen.

import ExcelJS from "exceljs";
import type { FastifyInstance } from "fastify";
import type { Config } from "../../config.js";
import { OFFICES, UNASSIGNED } from "../../domain/offices.js";
import { weekDayIndex } from "../../services/reporting/pacing.js";
import { isTargetsAdmin, resolveCsm } from "../../services/auth.js";
import { logger } from "../../services/logger.js";
import { adviserRoster } from "../../services/reporting/advisers.js";
import { tzToday } from "../../services/reporting/pace.js";
import { run } from "../../services/reporting/query.js";
import { shiftDays } from "../../services/reporting/trends.js";
import { uploadTargetsBlob } from "../../services/targets/blob.js";
import { parseDatarailsWorkbook, type AdviserRosterEntry } from "../../services/targets/parseDatarails.js";
import { PLAUSIBLE_MAX, parseTargetsWorkbook, runSoftChecks, type ParsedTargets } from "../../services/targets/parse.js";
import { parseWrittenTargetsWorkbooks } from "../../services/targets/parseWrittenTargets.js";
import { buildBlankTemplate } from "../../services/targets/template.js";
import {
  activateTargets,
  getCurrentAsParsedTargets,
  getLastParsed,
  getTargetsProvenance,
  mergeCaptured,
  type CapturedMap,
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
    // The manual template has a column for every figure and validation rejects a file missing any,
    // so a successful parse means all five are Capricorn's.
    const captured: Partial<CapturedMap> = { leads: true, applications: true, referrals: true, sales: true, written: true };
    try {
      // Persist THEN activate — never the other order, so a failed blob write can't leave the UI
      // claiming success while nothing durable happened.
      await uploadTargetsBlob(config.targets.storageAccount, rawBuffer, outcome.data, uploadedBy, uploadedAt, { captured: mergeCaptured(captured) ?? undefined });
    } catch (err) {
      logger.error("Targets blob write failed", { err: String(err) });
      return reply.code(502).send({ error: "Upload validated but could not be saved — please try again." });
    }
    activateTargets(outcome.data, uploadedBy, uploadedAt, undefined, captured);
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
      effectiveWeek: weekSaturday, // the Saturday chosen, verbatim — see WEEK_START above
      // Revenue = written commission £ (Mortgage + Insurance), from the same consolidated file's
      // written sheets. Each product left unchanged when its sheet has no data for the week.
      writtenWeekly: {
        mortgage: outcome.mortgageWritten ?? base.writtenWeekly.mortgage,
        insurance: outcome.insuranceWritten ?? base.writtenWeekly.insurance,
      },
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

    const writtenImported = outcome.mortgageWritten != null || outcome.insuranceWritten != null;
    const imported = [
      outcome.applicationsAvailable && "Applications",
      outcome.salesAvailable && "Sales & Referrals",
      writtenImported && "Revenue (written)",
    ].filter(Boolean).join(", ");
    const unchanged = [
      !outcome.applicationsAvailable && "Applications",
      !outcome.salesAvailable && "Sales & Referrals",
      !writtenImported && "Revenue",
      "Leads",
    ].filter(Boolean).join("/");
    const uploadedBy = viewer.email;
    const uploadedAt = new Date().toISOString();
    const note = `${imported} from Datarails import (week of ${weekSaturday}); ${unchanged} unchanged.`;
    // Leads is never in this file — it is a fixed group target — so it stays on whatever supplied it
    // last, which until Capricorn send one is our placeholder. That distinction is the whole point of
    // the map: it is why the Leads target can read 633 both before and after a successful upload.
    const captured: Partial<CapturedMap> = {
      applications: outcome.applicationsAvailable,
      sales: outcome.salesAvailable,
      referrals: outcome.salesAvailable,
      written: writtenImported,
    };
    try {
      await uploadTargetsBlob(config.targets.storageAccount, rawBuffer, merged, uploadedBy, uploadedAt, { captured: mergeCaptured(captured) ?? undefined, note });
    } catch (err) {
      logger.error("Targets blob write failed", { err: String(err) });
      return reply.code(502).send({ error: "Import validated but could not be saved — please try again." });
    }
    activateTargets(merged, uploadedBy, uploadedAt, note, captured);
    logger.info("Datarails targets import activated", { effectiveWeek: merged.effectiveWeek, uploadedBy, unmatched: outcome.unmatchedAdvisers.length });

    return reply.send({ ok: true, softWarnings, unmatchedAdvisers: outcome.unmatchedAdvisers, provenance: getTargetsProvenance() });
  });

  app.post("/api/targets/import-written", async (request, reply) => {
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

    let mortgageBuffer: Buffer | undefined;
    let insuranceBuffer: Buffer | undefined;
    let weekSaturday: string | undefined;
    for await (const part of request.parts()) {
      if (part.type === "file") {
        const buf = await part.toBuffer();
        if (part.fieldname === "mortgage") mortgageBuffer = buf;
        else if (part.fieldname === "insurance") insuranceBuffer = buf;
      } else if (part.fieldname === "week") {
        weekSaturday = String(part.value).trim();
      }
    }
    if (!mortgageBuffer || !insuranceBuffer) {
      return reply.code(400).send({ error: 'Both a Mortgage and an Insurance written-targets file are required (fields "mortgage" and "insurance").' });
    }
    if (!weekSaturday || !/^\d{4}-\d{2}-\d{2}$/.test(weekSaturday)) {
      return reply.code(400).send({ error: "A valid week (YYYY-MM-DD, the workbook's Saturday column) is required." });
    }

    const mortgageWb = new ExcelJS.Workbook();
    const insuranceWb = new ExcelJS.Workbook();
    try {
      await mortgageWb.xlsx.load(mortgageBuffer as unknown as ExcelJS.Buffer);
      await insuranceWb.xlsx.load(insuranceBuffer as unknown as ExcelJS.Buffer);
    } catch {
      return reply.code(422).send({ error: "Validation failed.", hardErrors: ["Could not read one of the files — are they valid .xlsx?"], softWarnings: [] });
    }

    const outcome = parseWrittenTargetsWorkbooks(mortgageWb, insuranceWb, weekSaturday);
    if (!outcome.ok || !outcome.writtenWeekly) {
      return reply.code(422).send({ error: "Validation failed.", hardErrors: outcome.hardErrors, softWarnings: outcome.softWarnings });
    }

    const today = tzToday(new Date(), config.reporting.timeZone);
    const base = getCurrentAsParsedTargets(today);
    const merged: ParsedTargets = {
      effectiveWeek: weekSaturday, // the Saturday chosen, verbatim — see WEEK_START above
      offices: base.offices,
      writtenWeekly: outcome.writtenWeekly,
    };

    const softWarnings = [...outcome.softWarnings, ...runSoftChecks(merged, getLastParsed(), today)];
    const uploadedBy = viewer.email;
    const uploadedAt = new Date().toISOString();
    const note = `Written targets from import (week of ${weekSaturday}): Mortgage £${Math.round(outcome.writtenWeekly.mortgage).toLocaleString()} + Insurance £${Math.round(outcome.writtenWeekly.insurance).toLocaleString()}/wk. Leads/Applications/Protection unchanged.`;
    const captured: Partial<CapturedMap> = { written: true };
    try {
      // Store the mortgage workbook as the audit artefact (the pair share a week + provenance row).
      await uploadTargetsBlob(config.targets.storageAccount, mortgageBuffer, merged, uploadedBy, uploadedAt, { captured: mergeCaptured(captured) ?? undefined, note });
    } catch (err) {
      logger.error("Targets blob write failed", { err: String(err) });
      return reply.code(502).send({ error: "Import validated but could not be saved — please try again." });
    }
    activateTargets(merged, uploadedBy, uploadedAt, note, captured);
    logger.info("Written targets import activated", { effectiveWeek: merged.effectiveWeek, uploadedBy });

    return reply.send({ ok: true, softWarnings, provenance: getTargetsProvenance() });
  });
  /**
   * Set the LEADS target, and only the leads target.
   *
   * Exists because there was no way at all for Capricorn to set one. Their Datarails export carries
   * no lead figures — thirteen sheets of written/paid/par and product-line case counts, none of them
   * leads — so `import-datarails` lists Leads as unchanged unconditionally, and the two-sheet manual
   * template that DOES have a Leads column was never wired to the frontend. The 633/wk on the wall
   * was therefore our own headcount placeholder, permanently, described on screen as "a fixed group
   * target". This is the route that unfixes it.
   *
   * Deliberately narrow. Routing this through the full-workbook upload would mean re-typing
   * Applications, Referrals, Sales and Revenue to change one number — the very figures Datarails
   * supplies — and since that upload REPLACES state, a stale hand-typed column would silently
   * overwrite real imported ones.
   */
  app.post("/api/targets/set-leads", async (request, reply) => {
    const viewer = resolveCsm(request.headers, config.devUserEmail);
    if (!viewer) {
      return reply.code(401).send({ error: "Not authenticated." });
    }
    if (!isTargetsAdmin(viewer.email, config.targets.adminEmails)) {
      return reply.code(403).send({ error: "Not authorized to set targets." });
    }
    if (!config.targets.storageAccount) {
      return reply.code(503).send({ error: "Targets storage isn't configured on this environment." });
    }

    const body = (request.body ?? {}) as { week?: unknown; leads?: unknown };
    const weekSaturday = typeof body.week === "string" ? body.week.trim() : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(weekSaturday)) {
      return reply.code(400).send({ error: "A valid week (YYYY-MM-DD, the Saturday the reporting week starts) is required." });
    }
    if (weekDayIndex(weekSaturday) !== 0) {
      return reply.code(400).send({ error: `${weekSaturday} is not a Saturday — the reporting week runs Sat–Fri.` });
    }
    if (typeof body.leads !== "object" || body.leads === null) {
      return reply.code(400).send({ error: "A `leads` object of office → weekly target is required." });
    }
    const submitted = body.leads as Record<string, unknown>;

    // Validate BEFORE touching state: a half-applied target set is worse than a rejected one.
    const hardErrors: string[] = [];
    const known = new Set(OFFICES.map((o) => o.name));
    for (const name of Object.keys(submitted)) {
      if (!known.has(name)) hardErrors.push(`Unknown office "${name}".`);
    }
    const weekly: Record<string, number> = {};
    for (const office of OFFICES) {
      const raw = submitted[office.name];
      if (raw == null || raw === "") {
        hardErrors.push(`"${office.name}" is missing a Leads figure.`);
        continue;
      }
      const n = typeof raw === "number" ? raw : Number(String(raw).replace(/,/g, "").trim());
      if (!Number.isFinite(n) || n < 0) {
        hardErrors.push(`"${office.name}" Leads must be a number ≥ 0.`);
        continue;
      }
      // Same ceiling the workbook parser applies, so a transposed digit can't land a 6330/wk target.
      if (n > PLAUSIBLE_MAX.leads) {
        hardErrors.push(`"${office.name}" Leads (${n}) exceeds the plausible maximum of ${PLAUSIBLE_MAX.leads}/wk.`);
        continue;
      }
      weekly[office.name] = n;
    }
    if (hardErrors.length > 0) {
      return reply.code(422).send({ error: "Validation failed.", hardErrors, softWarnings: [] });
    }

    const today = tzToday(new Date(), config.reporting.timeZone);
    const base = getCurrentAsParsedTargets(today);
    const merged: ParsedTargets = {
      effectiveWeek: shiftDays(weekSaturday, 2), // Saturday → the Monday that starts its working week
      writtenWeekly: base.writtenWeekly,
      offices: Object.fromEntries(
        Object.entries(base.offices).map(([office, values]) => [
          office,
          { ...values, leads: weekly[office] ?? values.leads },
        ]),
      ),
    };

    const softWarnings = runSoftChecks(merged, getLastParsed(), today);
    // Leads, and ONLY leads, is now Capricorn's. A positive one-key assertion rather than a rewritten
    // still-ours list: `mergeCaptured` ORs onto live provenance, so whatever an earlier workbook
    // supplied stays supplied and this route cannot mark Applications or Revenue as confirmed on the
    // way past. That stickiness is the reason provenance is stored per-figure at all.
    const captured: Partial<CapturedMap> = { leads: true };
    const total = Object.values(weekly).reduce((a, b) => a + b, 0);
    const uploadedBy = viewer.email;
    const uploadedAt = new Date().toISOString();
    const note = `Leads target set by hand (week of ${weekSaturday}): ${total}/wk across ${OFFICES.length} offices. Applications/Protection/Revenue unchanged.`;
    // The submitted figures ARE the audit artefact — there is no workbook behind this one.
    const artefact = Buffer.from(JSON.stringify({ week: weekSaturday, leads: weekly, setBy: uploadedBy }, null, 2));
    try {
      await uploadTargetsBlob(config.targets.storageAccount, artefact, merged, uploadedBy, uploadedAt, {
        note,
        captured: mergeCaptured(captured) ?? undefined,
        rawExt: "json",
      });
    } catch (err) {
      logger.error("Targets blob write failed", { err: String(err) });
      return reply.code(502).send({ error: "Validated but could not be saved — please try again." });
    }
    activateTargets(merged, uploadedBy, uploadedAt, note, captured);
    logger.info("Leads target set", { effectiveWeek: merged.effectiveWeek, uploadedBy, total });

    return reply.send({ ok: true, softWarnings, provenance: getTargetsProvenance() });
  });
}
