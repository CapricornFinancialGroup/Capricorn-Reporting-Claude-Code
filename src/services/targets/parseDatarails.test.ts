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
  mortgageWrittenRows?: Array<{ adviser: string; value: unknown }>;
  insuranceWrittenRows?: Array<{ adviser: string; value: unknown }>;
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
  // Written-target sheets (as in the consolidated workbook), only when the test supplies rows.
  if (opts.mortgageWrittenRows) {
    const sheet = wb.addWorksheet("Mortgage_Weekly_Written _Target"); // stray space as in the real export
    sheet.addRow(["Adviser", week]);
    for (const r of opts.mortgageWrittenRows) sheet.addRow([r.adviser, r.value]);
  }
  if (opts.insuranceWrittenRows) {
    const sheet = wb.addWorksheet("Insurance_Weekly_Written _Ta");
    sheet.addRow(["Adviser", week]);
    for (const r of opts.insuranceWrittenRows) sheet.addRow([r.adviser, r.value]);
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

describe("parseDatarailsWorkbook — written targets (Revenue) from the consolidated file", () => {
  it("sums Mortgage + Insurance written business-wide (£-strings tolerated), null when a sheet is absent", () => {
    const wb = buildWorkbook({
      mortgageWrittenRows: [
        { adviser: "Alex Smith", value: 10000 },
        { adviser: "Dale Shaw", value: "£8,000​" },
      ],
      // no insuranceWrittenRows → that sheet absent
    });
    const outcome = parseDatarailsWorkbook(wb, WEEK, ROSTER);
    expect(outcome.ok).toBe(true);
    expect(outcome.mortgageWritten).toBe(18000);
    expect(outcome.insuranceWritten).toBeNull();
  });

  it("is null for a written sheet with no data for the week (left unchanged, not zeroed)", () => {
    const wb = buildWorkbook({
      mortgageWrittenRows: [{ adviser: "Alex Smith", value: null }],
    });
    const outcome = parseDatarailsWorkbook(wb, WEEK, ROSTER);
    expect(outcome.mortgageWritten).toBeNull();
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

// Regression, 2026-08-13: a formula cell whose result Excel HAS cached is real data. Capricorn's
// week columns are XLOOKUPs into an external Mastersheet we can't resolve ourselves, but Excel
// stores the last computed value alongside the formula — dropping those read as "this week has no
// data" and left the KPI on its old target.
describe("parseDatarailsWorkbook — formula cells with cached results", () => {
  it("reads the cached result rather than discarding the cell", () => {
    const wb = buildWorkbook({
      parRows: [
        { adviser: "Alex Smith", value: { formula: "_xlfn.XLOOKUP(A2,[2]Mastersheet!$B$3:$B$64,[2]Mastersheet!$D$3:$D$64,0)", result: 30 } },
        { adviser: "Dale Shaw", value: { sharedFormula: "B2", result: "£40" } },
      ],
    });
    const outcome = parseDatarailsWorkbook(wb, WEEK, ROSTER);
    expect(outcome.applicationsAvailable).toBe(true);
    expect(outcome.offices?.["Mayfair"].applications).toBe(30);
    expect(outcome.offices?.["Hammersmith"].applications).toBe(40);
    expect(outcome.softWarnings.some((w) => w.includes("couldn't be read as numbers"))).toBe(false);
  });

  it("still treats a cached ERROR result as no figure", () => {
    const wb = buildWorkbook({
      parRows: [{ adviser: "Alex Smith", value: { formula: "A1/0", result: { error: "#DIV/0!" } } }],
    });
    const outcome = parseDatarailsWorkbook(wb, WEEK, ROSTER);
    expect(outcome.applicationsAvailable).toBe(false);
  });

  it("reads rich-text cells", () => {
    const wb = buildWorkbook({
      parRows: [{ adviser: "Alex Smith", value: { richText: [{ text: "1" }, { text: "2" }] } }],
    });
    const outcome = parseDatarailsWorkbook(wb, WEEK, ROSTER);
    expect(outcome.offices?.["Mayfair"].applications).toBe(12);
  });
});

// Regression, 2026-08-13: `dbo.useraccount` holds every platform account, not just advisers, so a
// common adviser name collides with client records — "Alex Smith" had ten usernames on the day this
// was found. Last-write-wins resolved him to a client account, which officeOf() calls Unassigned;
// 22 of the 71 protection cases in that day's upload were dropped out of their offices that way.
describe("parseDatarailsWorkbook — adviser name collisions in the lake roster", () => {
  const COLLIDING_ROSTER: AdviserRosterEntry[] = [
    { username: "alexsmith1994@yahoo.co.uk", fullName: "Alex Smith" }, // a client, listed first
    { username: "alex.smith@capricornfinancial.co.uk", fullName: "Alex Smith" }, // the real adviser
    { username: "alexsmi133@gmail.com", fullName: "Alex Smith" }, // another client, listed last
    { username: "dale@capricornfinancial.co.uk", fullName: "Dale Shaw" },
  ];

  it("prefers the office-mapped account regardless of row order", () => {
    const wb = buildWorkbook({});
    const outcome = parseDatarailsWorkbook(wb, WEEK, COLLIDING_ROSTER);
    expect(outcome.offices?.["Mayfair"]).toEqual({ applications: 3, sales: 2 });
    expect(outcome.offices?.["Unassigned"]).toBeUndefined();
  });

  it("still lands in Unassigned when NO account for that name is office-mapped", () => {
    const wb = buildWorkbook({ parRows: [{ adviser: "Alex Smith", value: 3 }] });
    const outcome = parseDatarailsWorkbook(wb, WEEK, [
      { username: "alexsmith1994@yahoo.co.uk", fullName: "Alex Smith" },
      { username: "alexsmi133@gmail.com", fullName: "Alex Smith" },
    ]);
    expect(outcome.offices?.["Unassigned"].applications).toBe(3);
    // Matched to an account, just not an office-mapped one — that's Unassigned, not unmatched.
    expect(outcome.unmatchedAdvisers).not.toContain("Alex Smith");
  });
});
