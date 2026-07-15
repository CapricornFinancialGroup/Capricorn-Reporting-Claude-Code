import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { parseWrittenTargetsWorkbooks } from "./parseWrittenTargets.js";

const WEEK = "2026-07-04"; // a Saturday, matching the workbook's column convention

function bookWith(sheetName: string, rows: Array<{ adviser: string; value: unknown }>, week = WEEK): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet(sheetName);
  sheet.addRow(["Adviser", week]);
  for (const r of rows) sheet.addRow([r.adviser, r.value]);
  return wb;
}

const mortgageBook = (rows: Array<{ adviser: string; value: unknown }>, week?: string) =>
  bookWith("Mortgage_Weekly_Written _Target", rows, week);
const insuranceBook = (rows: Array<{ adviser: string; value: unknown }>, week?: string) =>
  bookWith("Insurance_Weekly_Written _Ta", rows, week);

describe("parseWrittenTargetsWorkbooks — happy path", () => {
  it("sums each product's business-wide weekly £ (tolerating £-prefixed / zero-width-space strings)", () => {
    const outcome = parseWrittenTargetsWorkbooks(
      mortgageBook([
        { adviser: "Albano Toska", value: 10000 },
        { adviser: "Alex Smith", value: "£8,000​" },
      ]),
      insuranceBook([
        { adviser: "Albano Toska", value: 250 },
        { adviser: "Alex Smith", value: "£250​" },
      ]),
      WEEK,
    );
    expect(outcome.ok).toBe(true);
    expect(outcome.hardErrors).toEqual([]);
    expect(outcome.writtenWeekly).toEqual({ mortgage: 18000, insurance: 500 });
  });
});

describe("parseWrittenTargetsWorkbooks — hard errors", () => {
  it("no column for the requested week", () => {
    const outcome = parseWrittenTargetsWorkbooks(mortgageBook([{ adviser: "A", value: 1 }]), insuranceBook([{ adviser: "A", value: 1 }]), "2026-07-11");
    expect(outcome.ok).toBe(false);
    expect(outcome.writtenWeekly).toBeNull();
    expect(outcome.hardErrors.some((e) => e.includes("2026-07-11"))).toBe(true);
  });

  it("wrong sheet name (prefix not found)", () => {
    const wb = new ExcelJS.Workbook();
    const s = wb.addWorksheet("Something_Else");
    s.addRow(["Adviser", WEEK]);
    s.addRow(["A", 1]);
    const outcome = parseWrittenTargetsWorkbooks(wb, insuranceBook([{ adviser: "A", value: 1 }]), WEEK);
    expect(outcome.ok).toBe(false);
    expect(outcome.hardErrors.some((e) => e.includes("Mortgage_Weekly_Written"))).toBe(true);
  });

  it("neither product has data for the week → nothing to import", () => {
    const outcome = parseWrittenTargetsWorkbooks(
      mortgageBook([{ adviser: "A", value: null }]),
      insuranceBook([{ adviser: "A", value: null }]),
      WEEK,
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.hardErrors.some((e) => e.includes("Neither"))).toBe(true);
  });
});

describe("parseWrittenTargetsWorkbooks — one product empty", () => {
  it("imports the product that has data as-is and the empty one as £0 with a warning", () => {
    const outcome = parseWrittenTargetsWorkbooks(
      mortgageBook([{ adviser: "A", value: 12000 }]),
      insuranceBook([{ adviser: "A", value: null }]),
      WEEK,
    );
    expect(outcome.ok).toBe(true);
    expect(outcome.writtenWeekly).toEqual({ mortgage: 12000, insurance: 0 });
    expect(outcome.softWarnings.some((w) => w.includes("Insurance") && w.includes("£0"))).toBe(true);
  });
});
