import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { OFFICES } from "../../domain/offices.js";
import { parseTargetsWorkbook, type ParsedTargets } from "./parse.js";

const WEEK = "2026-07-06"; // a Monday

function buildWorkbook(opts: {
  officeRows?: Array<{ office: string; week: string; leads: number | string; applications: number | string; referrals: number | string; sales: number | string }>;
  revenueRow?: { week: string; mortgage: number | string; insurance: number | string };
  skipOfficeSheet?: boolean;
  skipRevenueSheet?: boolean;
  officeHeaders?: string[];
}): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  const officeRows =
    opts.officeRows ??
    OFFICES.map((o) => ({ office: o.name, week: WEEK, leads: 10, applications: 2, referrals: 1, sales: 1 }));
  const revenueRow = opts.revenueRow ?? { week: WEEK, mortgage: 350000, insurance: 75000 };

  if (!opts.skipOfficeSheet) {
    const sheet = wb.addWorksheet("Office Targets");
    sheet.addRow(opts.officeHeaders ?? ["Effective Week (Mon)", "Office", "Leads", "Applications", "Referrals", "Sales"]);
    for (const r of officeRows) sheet.addRow([r.week, r.office, r.leads, r.applications, r.referrals, r.sales]);
  }
  if (!opts.skipRevenueSheet) {
    const sheet = wb.addWorksheet("Revenue Target");
    sheet.addRow(["Effective Week (Mon)", "Weekly Mortgage Written", "Weekly Insurance Written"]);
    sheet.addRow([revenueRow.week, revenueRow.mortgage, revenueRow.insurance]);
  }
  return wb;
}

describe("parseTargetsWorkbook — happy path", () => {
  it("parses a well-formed workbook with all known offices", () => {
    const wb = buildWorkbook({});
    const outcome = parseTargetsWorkbook(wb, null, "2026-07-06");
    expect(outcome.ok).toBe(true);
    expect(outcome.hardErrors).toEqual([]);
    expect(outcome.data?.effectiveWeek).toBe(WEEK);
    expect(outcome.data?.writtenWeekly).toEqual({ mortgage: 350000, insurance: 75000 });
    expect(Object.keys(outcome.data?.offices ?? {})).toHaveLength(OFFICES.length);
    // existingCases is seeded to 0, not read from the sheet — it is tracked on the board but has no
    // target, so requiring a column would reject every workbook Capricorn already has.
    expect(outcome.data?.offices["Hammersmith"]).toEqual({ leads: 10, applications: 2, referrals: 1, sales: 1, existingCases: 0 });
  });
});

describe("parseTargetsWorkbook — hard errors (block the whole upload)", () => {
  it("missing sheet", () => {
    const wb = buildWorkbook({ skipRevenueSheet: true });
    const outcome = parseTargetsWorkbook(wb, null, WEEK);
    expect(outcome.ok).toBe(false);
    expect(outcome.data).toBeNull();
    expect(outcome.hardErrors.some((e) => e.includes("Revenue Target"))).toBe(true);
  });

  it("missing required column", () => {
    const wb = buildWorkbook({ officeHeaders: ["Effective Week (Mon)", "Office", "Leads", "Applications", "Referrals"] }); // no Sales
    const outcome = parseTargetsWorkbook(wb, null, WEEK);
    expect(outcome.ok).toBe(false);
    expect(outcome.hardErrors.some((e) => e.includes("Sales"))).toBe(true);
  });

  it("unknown office", () => {
    const rows = OFFICES.map((o) => ({ office: o.name, week: WEEK, leads: 10, applications: 2, referrals: 1, sales: 1 }));
    rows[0] = { ...rows[0], office: "Atlantis" };
    const wb = buildWorkbook({ officeRows: rows });
    const outcome = parseTargetsWorkbook(wb, null, WEEK);
    expect(outcome.ok).toBe(false);
    expect(outcome.hardErrors.some((e) => e.includes("Atlantis"))).toBe(true);
    // The real office that got overwritten is also reported missing — structurally prevents
    // "missing office → target silently goes to zero."
    expect(outcome.hardErrors.some((e) => e.includes(`is missing office "${OFFICES[0].name}"`))).toBe(true);
  });

  it("duplicate office", () => {
    const rows = OFFICES.map((o) => ({ office: o.name, week: WEEK, leads: 10, applications: 2, referrals: 1, sales: 1 }));
    rows.push({ ...rows[0] });
    const wb = buildWorkbook({ officeRows: rows });
    const outcome = parseTargetsWorkbook(wb, null, WEEK);
    expect(outcome.ok).toBe(false);
    expect(outcome.hardErrors.some((e) => e.includes("more than once"))).toBe(true);
  });

  it("missing office entirely", () => {
    const rows = OFFICES.slice(1).map((o) => ({ office: o.name, week: WEEK, leads: 10, applications: 2, referrals: 1, sales: 1 }));
    const wb = buildWorkbook({ officeRows: rows });
    const outcome = parseTargetsWorkbook(wb, null, WEEK);
    expect(outcome.ok).toBe(false);
    expect(outcome.hardErrors.some((e) => e.includes(`is missing office "${OFFICES[0].name}"`))).toBe(true);
  });

  it("effective week not a Monday", () => {
    const rows = OFFICES.map((o) => ({ office: o.name, week: "2026-07-07", leads: 10, applications: 2, referrals: 1, sales: 1 })); // Tuesday
    const wb = buildWorkbook({ officeRows: rows, revenueRow: { week: "2026-07-07", mortgage: 350000, insurance: 75000 } });
    const outcome = parseTargetsWorkbook(wb, null, WEEK);
    expect(outcome.ok).toBe(false);
    expect(outcome.hardErrors.some((e) => e.includes("not a Monday"))).toBe(true);
  });

  it("inconsistent effective week across office rows", () => {
    const rows = OFFICES.map((o, i) => ({ office: o.name, week: i === 0 ? "2026-06-29" : WEEK, leads: 10, applications: 2, referrals: 1, sales: 1 }));
    const wb = buildWorkbook({ officeRows: rows });
    const outcome = parseTargetsWorkbook(wb, null, WEEK);
    expect(outcome.ok).toBe(false);
    expect(outcome.hardErrors.some((e) => e.includes("doesn't match"))).toBe(true);
  });

  it("inconsistent effective week between sheets", () => {
    const wb = buildWorkbook({ revenueRow: { week: "2026-06-29", mortgage: 350000, insurance: 75000 } });
    const outcome = parseTargetsWorkbook(wb, null, WEEK);
    expect(outcome.ok).toBe(false);
    expect(outcome.hardErrors.some((e) => e.includes("Revenue Target") && e.includes("doesn't match"))).toBe(true);
  });

  it("non-numeric figure", () => {
    const rows = OFFICES.map((o) => ({ office: o.name, week: WEEK, leads: "lots", applications: 2, referrals: 1, sales: 1 }));
    const wb = buildWorkbook({ officeRows: rows });
    const outcome = parseTargetsWorkbook(wb, null, WEEK);
    expect(outcome.ok).toBe(false);
    expect(outcome.hardErrors.some((e) => e.includes("Leads"))).toBe(true);
  });

  it("negative figure", () => {
    const rows = OFFICES.map((o) => ({ office: o.name, week: WEEK, leads: -5, applications: 2, referrals: 1, sales: 1 }));
    const wb = buildWorkbook({ officeRows: rows });
    const outcome = parseTargetsWorkbook(wb, null, WEEK);
    expect(outcome.ok).toBe(false);
    expect(outcome.hardErrors.some((e) => e.includes("Leads"))).toBe(true);
  });

  it("collects every issue in one pass, not just the first", () => {
    const rows = OFFICES.slice(1).map((o) => ({ office: o.name, week: WEEK, leads: -5, applications: 2, referrals: 1, sales: 1 }));
    const wb = buildWorkbook({ officeRows: rows });
    const outcome = parseTargetsWorkbook(wb, null, WEEK);
    expect(outcome.ok).toBe(false);
    // Missing office AND the negative-figure errors on the remaining rows should both surface.
    expect(outcome.hardErrors.some((e) => e.includes("is missing office"))).toBe(true);
    expect(outcome.hardErrors.filter((e) => e.includes("Leads")).length).toBeGreaterThan(0);
  });
});

describe("parseTargetsWorkbook — soft warnings (upload still succeeds)", () => {
  it("effective week far from today", () => {
    const wb = buildWorkbook({});
    const outcome = parseTargetsWorkbook(wb, null, "2026-09-01"); // weeks away from WEEK
    expect(outcome.ok).toBe(true);
    expect(outcome.softWarnings.some((w) => w.includes("more than 14 days"))).toBe(true);
  });

  it("implausibly large figure", () => {
    const rows = OFFICES.map((o) => ({ office: o.name, week: WEEK, leads: o.name === "Hammersmith" ? 99999 : 10, applications: 2, referrals: 1, sales: 1 }));
    const wb = buildWorkbook({ officeRows: rows });
    const outcome = parseTargetsWorkbook(wb, null, WEEK);
    expect(outcome.ok).toBe(true);
    expect(outcome.softWarnings.some((w) => w.includes("Hammersmith") && w.includes("implausibly large"))).toBe(true);
  });

  it(">5x week-over-week swing vs the previous upload", () => {
    const previous: ParsedTargets = {
      effectiveWeek: "2026-06-29",
      offices: Object.fromEntries(OFFICES.map((o) => [o.name, { leads: 10, applications: 2, referrals: 1, sales: 1 }])),
      writtenWeekly: { mortgage: 350000, insurance: 75000 },
    };
    const rows = OFFICES.map((o) => ({ office: o.name, week: WEEK, leads: o.name === "Mayfair" ? 100 : 10, applications: 2, referrals: 1, sales: 1 }));
    const wb = buildWorkbook({ officeRows: rows });
    const outcome = parseTargetsWorkbook(wb, previous, WEEK);
    expect(outcome.ok).toBe(true);
    expect(outcome.softWarnings.some((w) => w.includes("Mayfair") && w.includes("swung"))).toBe(true);
  });

  it("drop to zero from previously-nonzero", () => {
    const previous: ParsedTargets = {
      effectiveWeek: "2026-06-29",
      offices: Object.fromEntries(OFFICES.map((o) => [o.name, { leads: 10, applications: 2, referrals: 1, sales: 1 }])),
      writtenWeekly: { mortgage: 350000, insurance: 75000 },
    };
    const rows = OFFICES.map((o) => ({ office: o.name, week: WEEK, leads: 10, applications: 2, referrals: 1, sales: o.name === "Newmarket" ? 0 : 1 }));
    const wb = buildWorkbook({ officeRows: rows });
    const outcome = parseTargetsWorkbook(wb, previous, WEEK);
    expect(outcome.ok).toBe(true);
    expect(outcome.softWarnings.some((w) => w.includes("Newmarket") && w.includes("dropped to 0"))).toBe(true);
  });

  it("no swing warning on a normal week-over-week change", () => {
    const previous: ParsedTargets = {
      effectiveWeek: "2026-06-29",
      offices: Object.fromEntries(OFFICES.map((o) => [o.name, { leads: 10, applications: 2, referrals: 1, sales: 1 }])),
      writtenWeekly: { mortgage: 350000, insurance: 75000 },
    };
    const rows = OFFICES.map((o) => ({ office: o.name, week: WEEK, leads: 12, applications: 2, referrals: 1, sales: 1 })); // +20%, unremarkable
    const wb = buildWorkbook({ officeRows: rows });
    const outcome = parseTargetsWorkbook(wb, previous, WEEK);
    expect(outcome.ok).toBe(true);
    expect(outcome.softWarnings).toEqual([]);
  });
});
