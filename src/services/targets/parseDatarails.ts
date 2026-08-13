// Pure parser for Capricorn's real Datarails export ("Weekly Targets.xlsx", Kyle, 2026-07-08) —
// a per-adviser, per-product-line workbook, structurally nothing like our own upload template
// (parse.ts). Four of its ~13 sheets feed dashboard targets — this consolidated file is the SINGLE
// upload Capricorn use (Luke, 2026-07-17: collapse the three upload cards to one Datarails import):
//
//   "Weekly_Par"                    — flat per-adviser weekly case-count benchmark. No case-count
//                                      "Target" sheet exists for mortgages, so this is the best
//                                      available proxy for the `applications` KPI (Luke, 2026-07-08:
//                                      confirmed use it, flagged as Par-derived not a real target).
//   "Insurance_Weekly_Target_Number" — per-adviser weekly protection case-count target. Capricorn's
//                                      "Insurance" here means protection (Luke confirmed) — maps to
//                                      the `sales`/`referrals` (pledge) target.
//   "Mortgage_Weekly_Written _Target" / "Insurance_Weekly_Written _Ta" — per-adviser weekly WRITTEN
//                                      COMMISSION £ (the dashboard's "Revenue"), summed business-wide.
//
// `leads` has no sheet here (hard-coded 633, Kyle) and is left untouched by callers. Each KPI is left
// unchanged when its sheet has no data for the week (see the merge in the import route) — never zeroed.
//
// The workbook has no Office column — only adviser names. Office attribution goes through the
// SAME single source of truth as everywhere else (domain/offices.ts's officeOf(username)), via a
// live roster of {username, fullName} passed in by the caller (kept out of this file so parsing
// stays pure/testable — see reporting/advisers.ts's adviserRoster()).

import ExcelJS from "exceljs";
import { UNASSIGNED, officeOf } from "../../domain/offices.js";
import { cellToNumber } from "./cell.js";

const PAR_SHEET = "Weekly_Par";
const INSURANCE_NUMBER_SHEET = "Insurance_Weekly_Target_Number";
// Written-target sheets in the same consolidated workbook (Arman's separate "Weekly Written" files
// are just extracts of these). Matched by name PREFIX — Capricorn's export has stray spaces in the
// sheet names ("Mortgage_Weekly_Written _Target", "Insurance_Weekly_Written _Ta").
const MORTGAGE_WRITTEN_PREFIX = "Mortgage_Weekly_Written";
const INSURANCE_WRITTEN_PREFIX = "Insurance_Weekly_Written";
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
  /** WEEKLY business-wide written targets, £ (the dashboard's "Revenue"), summed across every
   *  adviser row of the written sheets. Null when the sheet is absent or has no data for the week —
   *  the caller then leaves the existing written target untouched (same guard as Applications/Sales). */
  mortgageWritten: number | null;
  insuranceWritten: number | null;
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Index the roster by adviser full name, which is all the workbook gives us to join on.
 *
 *  `dbo.useraccount` is not an adviser table — it holds every account on the platform, clients and
 *  leads included, so a common name has MANY rows (13,486 full names had more than one username on
 *  2026-08-13; "Alex Smith" had ten). Last-write-wins on this map therefore resolved real advisers
 *  to a random client account, which `officeOf` then reports as Unassigned — 22 of the 71 protection
 *  cases in Kyle's 2026-08-13 upload (Alex Smith, Priti Kapdee, Tony Chryseliou and nine others,
 *  every one of them mapped in domain/offices.ts) were silently dropped out of their office's total
 *  that way.
 *
 *  So when a name collides, prefer the account that domain/offices.ts actually knows as an adviser.
 *  A name with no office-mapped account keeps its first-seen username and still lands in Unassigned
 *  — visibly, which is the point. */
function buildRosterIndex(roster: AdviserRosterEntry[]): Map<string, string | null> {
  const byName = new Map<string, string | null>();
  for (const adviser of roster) {
    if (!adviser.fullName) continue;
    const key = normalizeName(adviser.fullName);
    if (!byName.has(key)) {
      byName.set(key, adviser.username);
      continue;
    }
    const incumbentIsAdviser = officeOf(byName.get(key)) !== UNASSIGNED;
    if (!incumbentIsAdviser && officeOf(adviser.username) !== UNASSIGNED) {
      byName.set(key, adviser.username);
    }
  }
  return byName;
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

    const n = cellToNumber(row.getCell(weekCol).value);
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

/** Business-wide £ total for a written-target sheet (matched by name prefix) at `weekSaturday`.
 *  Null when the sheet is missing, mis-shaped, or has no readable figures for that week — the caller
 *  leaves the existing written target unchanged rather than importing a spurious 0. */
function sumWrittenBusinessWide(workbook: ExcelJS.Workbook, prefix: string, weekSaturday: string): number | null {
  const sheet = workbook.worksheets.find((ws) => ws.name.trim().startsWith(prefix));
  if (!sheet) return null;
  const headers = headerRow(sheet);
  if (headers[0] !== ADVISER_HEADER) return null;
  const weekColIndex = headers.indexOf(weekSaturday);
  if (weekColIndex === -1) return null;
  const weekCol = weekColIndex + 1;

  let total = 0;
  let numericCellsFound = 0;
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    if (!String(row.getCell(1).value ?? "").trim()) return;
    const n = cellToNumber(row.getCell(weekCol).value);
    if (n != null) {
      numericCellsFound++;
      total += n;
    }
  });
  return numericCellsFound > 0 ? total : null;
}

export function parseDatarailsWorkbook(
  workbook: ExcelJS.Workbook,
  weekSaturday: string,
  roster: AdviserRosterEntry[],
): DatarailsParseOutcome {
  const mortgageWritten = sumWrittenBusinessWide(workbook, MORTGAGE_WRITTEN_PREFIX, weekSaturday);
  const insuranceWritten = sumWrittenBusinessWide(workbook, INSURANCE_WRITTEN_PREFIX, weekSaturday);
  const hardErrors: string[] = [];
  const softWarnings: string[] = [];

  const parSheet = workbook.getWorksheet(PAR_SHEET);
  const insuranceSheet = workbook.getWorksheet(INSURANCE_NUMBER_SHEET);
  if (!parSheet) hardErrors.push(`Missing sheet "${PAR_SHEET}".`);
  if (!insuranceSheet) hardErrors.push(`Missing sheet "${INSURANCE_NUMBER_SHEET}".`);
  if (!parSheet || !insuranceSheet) {
    return { ok: false, hardErrors, softWarnings, offices: null, applicationsAvailable: false, salesAvailable: false, unmatchedAdvisers: [], mortgageWritten, insuranceWritten };
  }

  const rosterByName = buildRosterIndex(roster);

  const unmatched = new Set<string>();
  const apps = sumSheetByOffice(parSheet, weekSaturday, rosterByName, unmatched);
  const sales = sumSheetByOffice(insuranceSheet, weekSaturday, rosterByName, unmatched);
  if (apps.hardError) hardErrors.push(apps.hardError);
  if (sales.hardError) hardErrors.push(sales.hardError);
  if (hardErrors.length > 0) {
    return { ok: false, hardErrors, softWarnings, offices: null, applicationsAvailable: false, salesAvailable: false, unmatchedAdvisers: [], mortgageWritten, insuranceWritten };
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
    return { ok: false, hardErrors, softWarnings: [], offices: null, applicationsAvailable: false, salesAvailable: false, unmatchedAdvisers: [], mortgageWritten, insuranceWritten };
  }

  const offices: Record<string, OfficeAppsSales> = {};
  for (const office of new Set([...Object.keys(apps.byOffice), ...Object.keys(sales.byOffice)])) {
    offices[office] = { applications: apps.byOffice[office] ?? 0, sales: sales.byOffice[office] ?? 0 };
  }

  return { ok: true, hardErrors: [], softWarnings, offices, applicationsAvailable, salesAvailable, unmatchedAdvisers: Array.from(unmatched).sort(), mortgageWritten, insuranceWritten };
}
