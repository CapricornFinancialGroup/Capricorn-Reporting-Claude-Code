// Pure parser for Capricorn's real Datarails export ("Weekly Targets.xlsx", Kyle, 2026-07-08) —
// a per-adviser, per-product-line workbook, structurally nothing like our own upload template
// (parse.ts). Only two of its ~13 sheets map onto dashboard KPIs we track:
//
//   "Weekly_Par"                    — flat per-adviser weekly case-count benchmark. No case-count
//                                      "Target" sheet exists for mortgages, so this is the best
//                                      available proxy for the `applications` KPI (Luke, 2026-07-08:
//                                      confirmed use it, flagged as Par-derived not a real target).
//   "Insurance_Weekly_Target_Number" — per-adviser weekly protection case-count target. Capricorn's
//                                      "Insurance" here means protection (Luke confirmed) — maps to
//                                      the `sales` KPI ("Protection Sales").
//
// `leads`/`referrals`/revenue have no corresponding sheet in this workbook at all and are left
// untouched by callers (see store.ts's getCurrentAsParsedTargets + the merge in the import route).
//
// The workbook has no Office column — only adviser names. Office attribution goes through the
// SAME single source of truth as everywhere else (domain/offices.ts's officeOf(username)), via a
// live roster of {username, fullName} passed in by the caller (kept out of this file so parsing
// stays pure/testable — see reporting/advisers.ts's adviserRoster()).

import ExcelJS from "exceljs";
import { officeOf } from "../../domain/offices.js";

const PAR_SHEET = "Weekly_Par";
const INSURANCE_NUMBER_SHEET = "Insurance_Weekly_Target_Number";
const ADVISER_HEADER = "Adviser";

export interface AdviserRosterEntry {
  username: string | null;
  fullName: string | null;
}

export interface OfficeAppsSales {
  applications: number;
  sales: number;
}

export interface DatarailsParseOutcome {
  ok: boolean;
  hardErrors: string[];
  softWarnings: string[];
  offices: Record<string, OfficeAppsSales> | null;
  /** False when the sheet's column for this week has literally zero readable numbers across every
   *  adviser row (e.g. Weekly_Par isn't kept current — verified live 2026-07-08: it has no data at
   *  all past ~January 2026). The whole KPI is a candidate for zero-everywhere in that case, which
   *  is a worse number than whatever's currently active — callers must NOT merge that KPI in when
   *  false, and should leave the existing target untouched instead. */
  applicationsAvailable: boolean;
  salesAvailable: boolean;
  /** Adviser names in the workbook that couldn't be matched to a known lake adviser — their
   *  figures are excluded from the totals rather than guessed at. */
  unmatchedAdvisers: string[];
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/** ExcelJS gives back plain numbers for numeric cells, but this workbook also has numeric strings
 *  contaminated with zero-width-space characters, unresolved formula cells (`{formula: "..."}`,
 *  referencing an external, unavailable "Mastersheet" workbook — no cached result to read), and
 *  rich-text objects. Anything that isn't cleanly numeric is treated as "no data" (0), not an
 *  error — counted so callers can surface one summary warning. */
function cellToCount(value: unknown): number | null {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const cleaned = value.replace(/[^\d.-]/g, "");
    if (cleaned !== "" && !Number.isNaN(Number(cleaned))) return Number(cleaned);
    return null;
  }
  return null;
}

function headerRow(sheet: ExcelJS.Worksheet): string[] {
  const values = sheet.getRow(1).values as unknown[];
  return values.slice(1).map((v) => {
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    return String(v ?? "").trim();
  });
}

/** Sum one sheet's values for `weekSaturday` by office, resolving adviser rows via the roster.
 *  `numericCellsFound` counts every row (matched or not) with a cleanly-numeric value at that
 *  week's column — a whole-sheet signal of whether this week has real data at all, independent of
 *  adviser matching. */
function sumSheetByOffice(
  sheet: ExcelJS.Worksheet,
  weekSaturday: string,
  rosterByName: Map<string, string | null>,
  unmatched: Set<string>,
): { byOffice: Record<string, number>; skippedCells: number; numericCellsFound: number; hardError: string | null } {
  const headers = headerRow(sheet);
  if (headers[0] !== ADVISER_HEADER) {
    return { byOffice: {}, skippedCells: 0, numericCellsFound: 0, hardError: `"${sheet.name}" is missing the "${ADVISER_HEADER}" column.` };
  }
  const weekColIndex = headers.indexOf(weekSaturday);
  if (weekColIndex === -1) {
    return { byOffice: {}, skippedCells: 0, numericCellsFound: 0, hardError: `"${sheet.name}" has no column for week ${weekSaturday}.` };
  }
  const weekCol = weekColIndex + 1; // ExcelJS columns are 1-indexed

  const byOffice: Record<string, number> = {};
  let skippedCells = 0;
  let numericCellsFound = 0;
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const adviserName = String(row.getCell(1).value ?? "").trim();
    if (!adviserName) return;

    const n = cellToCount(row.getCell(weekCol).value);
    if (n != null) numericCellsFound++;

    const username = rosterByName.get(normalizeName(adviserName));
    if (username === undefined) {
      unmatched.add(adviserName);
      return;
    }
    if (n == null) {
      skippedCells++;
      return;
    }
    const office = officeOf(username);
    byOffice[office] = (byOffice[office] ?? 0) + n;
  });

  return { byOffice, skippedCells, numericCellsFound, hardError: null };
}

export function parseDatarailsWorkbook(
  workbook: ExcelJS.Workbook,
  weekSaturday: string,
  roster: AdviserRosterEntry[],
): DatarailsParseOutcome {
  const hardErrors: string[] = [];
  const softWarnings: string[] = [];

  const parSheet = workbook.getWorksheet(PAR_SHEET);
  const insuranceSheet = workbook.getWorksheet(INSURANCE_NUMBER_SHEET);
  if (!parSheet) hardErrors.push(`Missing sheet "${PAR_SHEET}".`);
  if (!insuranceSheet) hardErrors.push(`Missing sheet "${INSURANCE_NUMBER_SHEET}".`);
  if (!parSheet || !insuranceSheet) {
    return { ok: false, hardErrors, softWarnings, offices: null, applicationsAvailable: false, salesAvailable: false, unmatchedAdvisers: [] };
  }

  const rosterByName = new Map<string, string | null>();
  for (const adviser of roster) {
    if (adviser.fullName) rosterByName.set(normalizeName(adviser.fullName), adviser.username);
  }

  const unmatched = new Set<string>();
  const apps = sumSheetByOffice(parSheet, weekSaturday, rosterByName, unmatched);
  const sales = sumSheetByOffice(insuranceSheet, weekSaturday, rosterByName, unmatched);
  if (apps.hardError) hardErrors.push(apps.hardError);
  if (sales.hardError) hardErrors.push(sales.hardError);
  if (hardErrors.length > 0) {
    return { ok: false, hardErrors, softWarnings, offices: null, applicationsAvailable: false, salesAvailable: false, unmatchedAdvisers: [] };
  }

  const skippedCells = apps.skippedCells + sales.skippedCells;
  if (skippedCells > 0) {
    softWarnings.push(`${skippedCells} cell(s) in the workbook couldn't be read as numbers (formulas or unusual formatting) and were treated as 0.`);
  }

  const applicationsAvailable = apps.numericCellsFound > 0;
  const salesAvailable = sales.numericCellsFound > 0;
  if (!applicationsAvailable) {
    softWarnings.push(`"${PAR_SHEET}" has no readable figures for week ${weekSaturday} at all (not even zeros) — Applications targets were left unchanged rather than imported as 0.`);
  }
  if (!salesAvailable) {
    softWarnings.push(`"${INSURANCE_NUMBER_SHEET}" has no readable figures for week ${weekSaturday} at all (not even zeros) — Sales targets were left unchanged rather than imported as 0.`);
  }
  if (!applicationsAvailable && !salesAvailable) {
    hardErrors.push(`Neither sheet has any data for week ${weekSaturday} — nothing to import. Pick a different week.`);
    return { ok: false, hardErrors, softWarnings: [], offices: null, applicationsAvailable: false, salesAvailable: false, unmatchedAdvisers: [] };
  }

  const offices: Record<string, OfficeAppsSales> = {};
  for (const office of new Set([...Object.keys(apps.byOffice), ...Object.keys(sales.byOffice)])) {
    offices[office] = { applications: apps.byOffice[office] ?? 0, sales: sales.byOffice[office] ?? 0 };
  }

  return { ok: true, hardErrors: [], softWarnings, offices, applicationsAvailable, salesAvailable, unmatchedAdvisers: Array.from(unmatched).sort() };
}
