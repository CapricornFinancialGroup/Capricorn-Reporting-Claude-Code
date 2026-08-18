// Pure parser + validator for Arman's weekly targets workbook (item 1, 2026-07-07). No infra here
// — takes a buffer, returns a result; the upload route owns persistence and activation.
//
// Two sheets:
//   "Office Targets"  — one row per office: Effective Week (Sat), Office, Leads, Applications,
//                        Referrals, Sales (WEEKLY figures — "everything is measured against a
//                        WEEKLY target", targets.ts's own header).
//   "Revenue Target"  — one row, business-wide: Effective Week (Sat), Weekly Mortgage Written,
//                        Weekly Insurance Written (£; Kyle 2026-07-14: "Revenue" = written business).
//
// Validation collects EVERY issue in one pass rather than failing fast, so Arman gets one complete
// fix-list, not a whack-a-mole of one-error-at-a-time reports.
//   HARD (blocks the whole upload, nothing activates): both sheets present with required headers;
//     exactly the known offices (domain/offices.ts — single source of truth) present, each once;
//     effective week present, a Saturday, and consistent across both sheets; every figure present,
//     numeric, >= 0.
//   SOFT (upload succeeds, surfaced as a warning): effective week far from "now"; implausibly large
//     figures; >5x week-over-week swing or a drop to zero from previously-nonzero — the real
//     residual risk (a structurally-valid but simply-wrong number) hard validation can't catch.

import ExcelJS from "exceljs";
import { OFFICES } from "../../domain/offices.js";
import { TARGETED_KPI_KEYS, type KpiKey, type KpiTargets } from "../../domain/targets.js";

export interface ParsedTargets {
  /** YYYY-MM-DD, the SATURDAY that starts the board's Sat–Fri week. */
  effectiveWeek: string;
  /** WEEKLY figures per office (not daily — callers divide as needed). */
  offices: Record<string, KpiTargets>;
  /** WEEKLY business-wide written target, £ — Mortgage + Insurance (Kyle 2026-07-14: the dashboard's
   *  "Revenue" is written business, split by product, each target-vs-actual). */
  writtenWeekly: { mortgage: number; insurance: number };
}

export interface ParseOutcome {
  ok: boolean;
  data: ParsedTargets | null;
  hardErrors: string[];
  softWarnings: string[];
}

const OFFICE_SHEET = "Office Targets";
const REVENUE_SHEET = "Revenue Target";
const WEEK_HEADER = "Effective Week (Sat)";
const OFFICE_HEADER = "Office";
const MORTGAGE_WRITTEN_HEADER = "Weekly Mortgage Written";
const INSURANCE_WRITTEN_HEADER = "Weekly Insurance Written";
// Capricorn's spreadsheet columns. Only the TARGETED KPIs appear: `existingCases` is tracked on the
// board but has no target, so demanding a column for it would reject every file they already have.
const KPI_HEADER: Record<KpiKey, string> = {
  leads: "Leads", applications: "Applications", referrals: "Referrals", sales: "Sales",
  existingCases: "Existing Client Cases",
};

// Soft-warning ceilings — generous multiples of the current placeholder scale (domain/targets.ts),
// not a real business limit. A weekly figure above this reads as a data-entry slip worth flagging,
// not something to hard-block on (it might genuinely be right).
const PLAUSIBLE_MAX: KpiTargets = { leads: 3000, applications: 600, referrals: 300, sales: 300, existingCases: 3000 };
const PLAUSIBLE_MAX_REVENUE = 2_000_000;
const SWING_MULTIPLE = 5;
const FAR_FROM_NOW_DAYS = 14;

/** The board's week runs Saturday to Friday (Saturday became a real trading day 2026-08-04), so a
 *  target week is identified by its Saturday — the same date the Datarails import asks for. */
function isSaturday(iso: string): boolean {
  return new Date(`${iso}T00:00:00Z`).getUTCDay() === 6;
}

function daysBetween(a: string, b: string): number {
  const ms = new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime();
  return Math.round(ms / 86_400_000);
}

/** ExcelJS returns Date objects for date-formatted cells, or a string/number otherwise. */
function cellToIsoDate(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "string") {
    const m = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return m[0];
  }
  return null;
}

function cellToNumber(value: unknown): number | null {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) return Number(value);
  return null;
}

function headerRow(sheet: ExcelJS.Worksheet): string[] {
  const row = sheet.getRow(1);
  const values = row.values as unknown[]; // 1-indexed; index 0 is unused
  return values.slice(1).map((v) => String(v ?? "").trim());
}

function colIndex(headers: string[], name: string): number {
  return headers.indexOf(name) + 1; // ExcelJS columns are 1-indexed; -1 → 0 (not found)
}

/**
 * Parse + validate the uploaded workbook. `previous` (the currently-active targets, if any) feeds
 * the week-over-week swing check; `today` (YYYY-MM-DD) feeds the far-from-now check. Both are
 * caller-supplied rather than read internally, so this stays a pure, easily-testable function.
 */
export function parseTargetsWorkbook(
  workbook: ExcelJS.Workbook,
  previous: ParsedTargets | null,
  today: string,
): ParseOutcome {
  const hardErrors: string[] = [];
  const softWarnings: string[] = [];

  const officeSheet = workbook.getWorksheet(OFFICE_SHEET);
  const revenueSheet = workbook.getWorksheet(REVENUE_SHEET);
  if (!officeSheet) hardErrors.push(`Missing sheet "${OFFICE_SHEET}".`);
  if (!revenueSheet) hardErrors.push(`Missing sheet "${REVENUE_SHEET}".`);
  if (!officeSheet || !revenueSheet) return { ok: false, data: null, hardErrors, softWarnings };

  // --- Office Targets ---
  const officeHeaders = headerRow(officeSheet);
  const requiredOfficeHeaders = [WEEK_HEADER, OFFICE_HEADER, ...TARGETED_KPI_KEYS.map((k) => KPI_HEADER[k])];
  for (const h of requiredOfficeHeaders) {
    if (!officeHeaders.includes(h)) hardErrors.push(`"${OFFICE_SHEET}" is missing column "${h}".`);
  }
  if (hardErrors.length > 0) return { ok: false, data: null, hardErrors, softWarnings };

  const weekCol = colIndex(officeHeaders, WEEK_HEADER);
  const officeCol = colIndex(officeHeaders, OFFICE_HEADER);
  const kpiCols = Object.fromEntries(TARGETED_KPI_KEYS.map((k) => [k, colIndex(officeHeaders, KPI_HEADER[k])])) as Record<KpiKey, number>;

  const knownOffices = new Set(OFFICES.map((o) => o.name));
  const seenOffices = new Set<string>();
  const officeWeekly: Record<string, KpiTargets> = {};
  let effectiveWeek: string | null = null;

  officeSheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const officeName = String(row.getCell(officeCol).value ?? "").trim();
    if (!officeName) return; // blank trailing row

    if (!knownOffices.has(officeName)) {
      hardErrors.push(`"${OFFICE_SHEET}": unknown office "${officeName}" (not in the current office list).`);
    } else if (seenOffices.has(officeName)) {
      hardErrors.push(`"${OFFICE_SHEET}": "${officeName}" appears more than once.`);
    } else {
      seenOffices.add(officeName);
    }

    const week = cellToIsoDate(row.getCell(weekCol).value);
    if (!week) {
      hardErrors.push(`"${OFFICE_SHEET}", row for "${officeName}": effective week is missing or not a date.`);
    } else if (effectiveWeek == null) {
      effectiveWeek = week;
    } else if (week !== effectiveWeek) {
      hardErrors.push(`"${OFFICE_SHEET}", row for "${officeName}": effective week ${week} doesn't match the other rows (${effectiveWeek}).`);
    }

    // Seeded, not left undefined: the sheet has no column for the untargeted KPIs.
    const values = { existingCases: 0 } as KpiTargets;
    for (const kpi of TARGETED_KPI_KEYS) {
      const raw = row.getCell(kpiCols[kpi]).value;
      const n = cellToNumber(raw);
      if (n == null || n < 0) {
        hardErrors.push(`"${OFFICE_SHEET}", row for "${officeName}": "${KPI_HEADER[kpi]}" must be a number ≥ 0.`);
      } else {
        values[kpi] = n;
      }
    }
    if (knownOffices.has(officeName)) officeWeekly[officeName] = values;
  });

  for (const office of knownOffices) {
    if (!seenOffices.has(office)) hardErrors.push(`"${OFFICE_SHEET}" is missing office "${office}".`);
  }

  // --- Revenue Target (written business, £ — Mortgage + Insurance) ---
  const revenueHeaders = headerRow(revenueSheet);
  for (const h of [WEEK_HEADER, MORTGAGE_WRITTEN_HEADER, INSURANCE_WRITTEN_HEADER]) {
    if (!revenueHeaders.includes(h)) hardErrors.push(`"${REVENUE_SHEET}" is missing column "${h}".`);
  }
  let mortgageWritten: number | null = null;
  let insuranceWritten: number | null = null;
  if ([WEEK_HEADER, MORTGAGE_WRITTEN_HEADER, INSURANCE_WRITTEN_HEADER].every((h) => revenueHeaders.includes(h))) {
    const rWeekCol = colIndex(revenueHeaders, WEEK_HEADER);
    const rMortCol = colIndex(revenueHeaders, MORTGAGE_WRITTEN_HEADER);
    const rInsCol = colIndex(revenueHeaders, INSURANCE_WRITTEN_HEADER);
    const row = revenueSheet.getRow(2);
    const week = cellToIsoDate(row.getCell(rWeekCol).value);
    mortgageWritten = cellToNumber(row.getCell(rMortCol).value);
    insuranceWritten = cellToNumber(row.getCell(rInsCol).value);
    if (!week) {
      hardErrors.push(`"${REVENUE_SHEET}": effective week is missing or not a date.`);
    } else if (effectiveWeek == null) {
      effectiveWeek = week;
    } else if (week !== effectiveWeek) {
      hardErrors.push(`"${REVENUE_SHEET}": effective week ${week} doesn't match "${OFFICE_SHEET}" (${effectiveWeek}).`);
    }
    if (mortgageWritten == null || mortgageWritten < 0) {
      hardErrors.push(`"${REVENUE_SHEET}": "${MORTGAGE_WRITTEN_HEADER}" must be a number ≥ 0.`);
    }
    if (insuranceWritten == null || insuranceWritten < 0) {
      hardErrors.push(`"${REVENUE_SHEET}": "${INSURANCE_WRITTEN_HEADER}" must be a number ≥ 0.`);
    }
  }

  if (effectiveWeek != null && !isSaturday(effectiveWeek)) {
    hardErrors.push(`Effective week "${effectiveWeek}" is not a Saturday (the board's week runs Sat–Fri).`);
  }

  if (hardErrors.length > 0) return { ok: false, data: null, hardErrors, softWarnings };

  const data: ParsedTargets = {
    effectiveWeek: effectiveWeek!,
    offices: officeWeekly,
    writtenWeekly: { mortgage: mortgageWritten!, insurance: insuranceWritten! },
  };

  return { ok: true, data, hardErrors: [], softWarnings: runSoftChecks(data, previous, today) };
}

/** Soft-warning checks shared by every path that activates a `ParsedTargets` (the manual upload
 *  above, and the Datarails import route) — far-from-now week, implausible max, >5x week-over-week
 *  swing or a drop to zero. These never block activation, they just surface a residual risk hard
 *  validation can't catch: a structurally-valid but simply-wrong number. */
export function runSoftChecks(data: ParsedTargets, previous: ParsedTargets | null, today: string): string[] {
  const softWarnings: string[] = [];

  if (Math.abs(daysBetween(today, data.effectiveWeek)) > FAR_FROM_NOW_DAYS) {
    softWarnings.push(`Effective week "${data.effectiveWeek}" is more than ${FAR_FROM_NOW_DAYS} days from today (${today}) — check this is the week you meant.`);
  }
  for (const [office, values] of Object.entries(data.offices)) {
    for (const kpi of TARGETED_KPI_KEYS) {
      if (values[kpi] > PLAUSIBLE_MAX[kpi]) {
        softWarnings.push(`"${office}" ${KPI_HEADER[kpi]} (${values[kpi]}) looks implausibly large — double-check it.`);
      }
    }
  }
  const combined = data.writtenWeekly.mortgage + data.writtenWeekly.insurance;
  if (combined > PLAUSIBLE_MAX_REVENUE) {
    softWarnings.push(`Weekly Written (£${Math.round(combined).toLocaleString()}) looks implausibly large — double-check it.`);
  }
  if (previous) {
    const prevCombined = previous.writtenWeekly.mortgage + previous.writtenWeekly.insurance;
    for (const [office, values] of Object.entries(data.offices)) {
      const prev = previous.offices[office];
      if (!prev) continue;
      for (const kpi of TARGETED_KPI_KEYS) {
        const prevVal = prev[kpi];
        const newVal = values[kpi];
        if (prevVal > 0 && newVal === 0) {
          softWarnings.push(`"${office}" ${KPI_HEADER[kpi]} dropped to 0 from ${prevVal} last week — is that intentional?`);
        } else if (prevVal > 0 && (newVal > prevVal * SWING_MULTIPLE || newVal < prevVal / SWING_MULTIPLE)) {
          softWarnings.push(`"${office}" ${KPI_HEADER[kpi]} swung more than ${SWING_MULTIPLE}x week-over-week (${prevVal} → ${newVal}) — check for a transposed digit.`);
        }
      }
    }
    if (prevCombined > 0 && combined === 0) {
      softWarnings.push(`Weekly Written dropped to £0 from £${Math.round(prevCombined).toLocaleString()} last week — is that intentional?`);
    } else if (prevCombined > 0 && (combined > prevCombined * SWING_MULTIPLE || combined < prevCombined / SWING_MULTIPLE)) {
      softWarnings.push(`Weekly Written swung more than ${SWING_MULTIPLE}x week-over-week (£${Math.round(prevCombined).toLocaleString()} → £${Math.round(combined).toLocaleString()}) — check for a transposed digit.`);
    }
  }

  return softWarnings;
}
