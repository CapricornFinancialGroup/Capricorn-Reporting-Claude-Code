import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { parseDatarailsWorkbook, type AdviserRosterEntry } from "./parseDatarails.js";

const WEEK = "2026-07-11"; // a Saturday, matching the real workbook's column convention

// Real ADVISER_OFFICE entries (domain/offices.ts) so office resolution is exercised for real.
const ROSTER: AdviserRosterEntry[] = [
  { username: "alex.smith@capricornfinancial.co.uk", fullName: "Alex Smith" }, // Mayfair
  { username: "dale@capricornfinancial.co.uk", fullName: "Dale Shaw" }, // Hammersmith
];

function buildWorkbook(opts: {
  parRows?: Array<{ adviser: string; value: unknown }>;
  insuranceRows?: Array<{ adviser: string; value: unknown }>;
  skipParSheet?: boolean;
  skipInsuranceSheet?: boolean;
  week?: string;
}): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  const week = opts.week ?? WEEK;
  const parRows = opts.parRows ?? [
    { adviser: "Alex Smith", value: 3 },
    { adviser: "Dale Shaw", value: 4 },
  ];
  const insuranceRows = opts.insuranceRows ?? [
    { adviser: "Alex Smith", value: 2 },
    { adviser: "Dale Shaw", value: 1 },
  ];

  if (!opts.skipParSheet) {
    const sheet = wb.addWorksheet("Weekly_Par");
    sheet.addRow(["Adviser", week]);
    for (const r of parRows) sheet.addRow([r.adviser, r.value]);
  }
  if (!opts.skipInsuranceSheet) {
    const sheet = wb.addWorksheet("Insurance_Weekly_Target_Number");
    sheet.addRow(["Adviser", week]);
    for (const r of insuranceRows) sheet.addRow([r.adviser, r.value]);
  }
  return wb;
}

describe("parseDatarailsWorkbook — happy path", () => {
  it("aggregates Applications (Par) and Sales (Insurance Number) by office", () => {
    const wb = buildWorkbook({});
    const outcome = parseDatarailsWorkbook(wb, WEEK, ROSTER);
    expect(outcome.ok).toBe(true);
    expect(outcome.hardErrors).toEqual([]);
    expect(outcome.applicationsAvailable).toBe(true);
    expect(outcome.salesAvailable).toBe(true);
    expect(outcome.unmatchedAdvisers).toEqual([]);
    expect(outcome.offices).toEqual({
      Mayfair: { applications: 3, sales: 2 },
      Hammersmith: { applications: 4, sales: 1 },
    });
  });

  it("sums multiple advisers into the same office", () => {
    const roster: AdviserRosterEntry[] = [
      ...ROSTER,
      { username: "priti@capricornfinancial.co.uk", fullName: "Priti Kapdee" }, // also Mayfair
    ];
    const wb = buildWorkbook({
      parRows: [
        { adviser: "Alex Smith", value: 3 },
        { adviser: "Priti Kapdee", value: 5 },
        { adviser: "Dale Shaw", value: 4 },
      ],
    });
    const outcome = parseDatarailsWorkbook(wb, WEEK, roster);
    expect(outcome.offices?.["Mayfair"].applications).toBe(8);
  });
});

describe("parseDatarailsWorkbook — unmatched advisers", () => {
  it("excludes advisers with no roster match and lists them", () => {
    const wb = buildWorkbook({
      parRows: [
        { adviser: "Alex Smith", value: 3 },
        { adviser: "Nobody Real", value: 99 },
      ],
    });
    const outcome = parseDatarailsWorkbook(wb, WEEK, ROSTER);
    expect(outcome.ok).toBe(true);
    expect(outcome.unmatchedAdvisers).toContain("Nobody Real");
    expect(outcome.offices?.["Mayfair"].applications).toBe(3);
  });
});

describe("parseDatarailsWorkbook — messy cells", () => {
  it("treats unresolved formula cells and non-numeric strings as 0, with a soft warning", () => {
    const wb = buildWorkbook({
      parRows: [
        { adviser: "Alex Smith", value: { formula: "_xlfn.XLOOKUP(A2,[2]Mastersheet!$B$3:$B$64,[2]Mastersheet!$D$3:$D$64,0)" } },
        { adviser: "Dale Shaw", value: "4​" }, // zero-width-space-contaminated numeric string
      ],
    });
    const outcome = parseDatarailsWorkbook(wb, WEEK, ROSTER);
    expect(outcome.ok).toBe(true);
    expect(outcome.offices?.["Mayfair"].applications).toBe(0);
    expect(outcome.offices?.["Hammersmith"].applications).toBe(4);
    expect(outcome.softWarnings.some((w) => w.includes("couldn't be read as numbers"))).toBe(true);
  });
});

describe("parseDatarailsWorkbook — hard errors", () => {
  it("missing a required sheet", () => {
    const wb = buildWorkbook({ skipParSheet: true });
    const outcome = parseDatarailsWorkbook(wb, WEEK, ROSTER);
    expect(outcome.ok).toBe(false);
    expect(outcome.offices).toBeNull();
    expect(outcome.hardErrors.some((e) => e.includes("Weekly_Par"))).toBe(true);
  });

  it("week not present as a column", () => {
    const wb = buildWorkbook({ week: "2026-07-04" });
    const outcome = parseDatarailsWorkbook(wb, WEEK, ROSTER);
    expect(outcome.ok).toBe(false);
    expect(outcome.hardErrors.some((e) => e.includes(WEEK))).toBe(true);
  });
});

// Real-world finding (verified live against Capricorn's actual workbook, 2026-07-08): Weekly_Par
// has a column for every current week but literally no data has been entered past ~Jan 2026 — it's
// an abandoned sheet, not a live one. Importing "0" in that case would silently zero out a real
// dashboard KPI, which is worse than leaving the existing target alone.
describe("parseDatarailsWorkbook — a sheet with a week column but zero real data (e.g. an abandoned sheet)", () => {
  it("marks that KPI unavailable, leaves its office numbers at 0, and warns — without failing the whole import", () => {
    const wb = buildWorkbook({
      parRows: [
        { adviser: "Alex Smith", value: null },
        { adviser: "Dale Shaw", value: null },
      ],
    });
    const outcome = parseDatarailsWorkbook(wb, WEEK, ROSTER);
    expect(outcome.ok).toBe(true);
    expect(outcome.applicationsAvailable).toBe(false);
    expect(outcome.salesAvailable).toBe(true);
    expect(outcome.offices?.["Mayfair"]).toEqual({ applications: 0, sales: 2 });
    expect(outcome.softWarnings.some((w) => w.includes("Weekly_Par") && w.includes("left unchanged"))).toBe(true);
  });

  it("hard-fails when NEITHER sheet has any data for the week (nothing to import)", () => {
    const wb = buildWorkbook({
      parRows: [{ adviser: "Alex Smith", value: null }],
      insuranceRows: [{ adviser: "Alex Smith", value: null }],
    });
    const outcome = parseDatarailsWorkbook(wb, WEEK, ROSTER);
    expect(outcome.ok).toBe(false);
    expect(outcome.offices).toBeNull();
    expect(outcome.hardErrors.some((e) => e.includes("Neither sheet"))).toBe(true);
  });
});
