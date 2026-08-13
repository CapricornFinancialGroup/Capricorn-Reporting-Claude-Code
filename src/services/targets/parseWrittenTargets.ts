// Parser for Capricorn's two Weekly Written Targets workbooks (Arman) — the £ targets behind the
// dashboard's "Revenue" figure, which Kyle confirmed 2026-07-14 is written business, split Mortgage
// + Insurance. Each workbook is the same per-adviser / weekly-Saturday-column shape as the Datarails
// export (parseDatarails.ts); we only need the business-wide weekly total per product, so this sums
// every adviser row for the chosen week — no roster/office attribution needed (the Revenue figure is
// business-wide, unlike the four per-office KPIs).
//
//   "Weekly Mortgage Written Targets.xlsx"  → sheet "Mortgage_Weekly_Written _Target"  (loan £)
//   "Weekly Insurance Written Targets.xlsx" → sheet "Insurance_Weekly_Written _Ta"     (policy £)
//
// Values arrive as plain numbers, "£250"-style strings contaminated with zero-width spaces, formula
// cells or rich text — all handled by the shared cell.ts coercion parseDatarails also uses. Sheet
// names carry stray spaces in Capricorn's export, so sheets are matched by name PREFIX rather than
// exact string.

import ExcelJS from "exceljs";
import { cellToNumber } from "./cell.js";

const MORTGAGE_SHEET_PREFIX = "Mortgage_Weekly_Written";
const INSURANCE_SHEET_PREFIX = "Insurance_Weekly_Written";
const ADVISER_HEADER = "Adviser";

export interface WrittenTargetsParseOutcome {
  ok: boolean;
  hardErrors: string[];
  softWarnings: string[];
  /** WEEKLY business-wide written targets, £. Null when parsing failed. */
  writtenWeekly: { mortgage: number; insurance: number } | null;
}

function headerRow(sheet: ExcelJS.Worksheet): string[] {
  const values = sheet.getRow(1).values as unknown[];
  return values.slice(1).map((v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? "").trim()));
}

function findSheet(workbook: ExcelJS.Workbook, prefix: string): ExcelJS.Worksheet | undefined {
  return workbook.worksheets.find((ws) => ws.name.trim().startsWith(prefix));
}

/** Sum every adviser row's value at `weekSaturday`. Returns null total when the sheet has no readable
 *  figures for that week at all (an abandoned/not-yet-filled week — same guard as the Datarails
 *  import, so we never overwrite a real target with a spurious 0). */
function sumWeek(
  workbook: ExcelJS.Workbook,
  prefix: string,
  weekSaturday: string,
  label: string,
): { total: number | null; hardError: string | null } {
  const sheet = findSheet(workbook, prefix);
  if (!sheet) return { total: null, hardError: `${label}: could not find a "${prefix}…" sheet in the workbook.` };
  const headers = headerRow(sheet);
  if (headers[0] !== ADVISER_HEADER) {
    return { total: null, hardError: `${label}: "${sheet.name}" is missing the "${ADVISER_HEADER}" column.` };
  }
  const weekIndex = headers.indexOf(weekSaturday);
  if (weekIndex === -1) return { total: null, hardError: `${label}: "${sheet.name}" has no column for week ${weekSaturday}.` };
  const weekCol = weekIndex + 1;

  let total = 0;
  let numericCellsFound = 0;
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    if (!String(row.getCell(1).value ?? "").trim()) return; // blank/trailing row
    const n = cellToNumber(row.getCell(weekCol).value);
    if (n != null) {
      numericCellsFound++;
      total += n;
    }
  });

  return { total: numericCellsFound > 0 ? total : null, hardError: null };
}

/** Parse both written-target workbooks for one Saturday-anchored week into business-wide weekly £
 *  totals. Hard-fails if a sheet/column is missing or neither product has any data for the week. */
export function parseWrittenTargetsWorkbooks(
  mortgageWorkbook: ExcelJS.Workbook,
  insuranceWorkbook: ExcelJS.Workbook,
  weekSaturday: string,
): WrittenTargetsParseOutcome {
  const hardErrors: string[] = [];
  const softWarnings: string[] = [];

  const mortgage = sumWeek(mortgageWorkbook, MORTGAGE_SHEET_PREFIX, weekSaturday, "Mortgage written");
  const insurance = sumWeek(insuranceWorkbook, INSURANCE_SHEET_PREFIX, weekSaturday, "Insurance written");
  if (mortgage.hardError) hardErrors.push(mortgage.hardError);
  if (insurance.hardError) hardErrors.push(insurance.hardError);
  if (hardErrors.length > 0) return { ok: false, hardErrors, softWarnings, writtenWeekly: null };

  if (mortgage.total == null && insurance.total == null) {
    hardErrors.push(`Neither written-targets sheet has any figures for week ${weekSaturday} — nothing to import. Pick a different week.`);
    return { ok: false, hardErrors, softWarnings, writtenWeekly: null };
  }
  if (mortgage.total == null) softWarnings.push(`Mortgage written targets have no figures for week ${weekSaturday} — imported as £0.`);
  if (insurance.total == null) softWarnings.push(`Insurance written targets have no figures for week ${weekSaturday} — imported as £0.`);

  return {
    ok: true,
    hardErrors: [],
    softWarnings,
    writtenWeekly: { mortgage: mortgage.total ?? 0, insurance: insurance.total ?? 0 },
  };
}
