import { beforeEach, describe, expect, it } from "vitest";
import { OFFICES } from "../../domain/offices.js";
import { DAILY_TARGETS, OFFICE_DAILY_TARGETS, WRITTEN_WEEKLY_TARGET } from "../../domain/targets.js";
import type { ParsedTargets } from "./parse.js";
import {
  activateTargets,
  getCurrentAsParsedTargets,
  getDailyTargets,
  getLastParsed,
  getOfficeDailyTargets,
  getTargetsProvenance,
  getWrittenWeeklyTargets,
  resetTargetsForTest,
} from "./store.js";

beforeEach(() => resetTargetsForTest());

describe("store — seeded from placeholders, zero behaviour change before any upload", () => {
  it("returns the exact placeholder constants", () => {
    expect(getDailyTargets()).toEqual(DAILY_TARGETS);
    expect(getOfficeDailyTargets()).toEqual(OFFICE_DAILY_TARGETS);
    expect(getWrittenWeeklyTargets()).toEqual(WRITTEN_WEEKLY_TARGET);
    // Before any upload NO target is Capricorn's, so every targeted KPI is listed as unconfirmed.
    // Asserted exhaustively rather than loosened: the board words its "except X" caveat off this
    // list, and a KPI silently dropping out of it would have the wall claim a figure is Capricorn's
    // when it is still ours.
    expect(getTargetsProvenance()).toEqual({
      source: "placeholder",
      effectiveWeek: null,
      uploadedBy: null,
      uploadedAt: null,
      unconfirmed: ["leads", "applications", "referrals", "sales"],
    });
    expect(getLastParsed()).toBeNull();
  });
});

describe("store — activateTargets", () => {
  it("converts uploaded WEEKLY KPI figures to DAILY (÷5), keeps written targets WEEKLY, and sums offices", () => {
    const parsed: ParsedTargets = {
      effectiveWeek: "2026-07-06",
      offices: Object.fromEntries(OFFICES.map((o) => [o.name, { leads: 50, applications: 10, referrals: 5, sales: 5 }])),
      writtenWeekly: { mortgage: 200_000, insurance: 50_000 },
    };
    activateTargets(parsed, "arman@capricornfinancial.co.uk", "2026-07-06T09:00:00.000Z");

    // existingCases is 0 throughout: the upload sheet has no column for it (untargeted by design),
    // and `?? 0` in the ÷5 keeps it a real zero rather than the NaN a missing key used to produce.
    expect(getOfficeDailyTargets()["Hammersmith"]).toEqual({ leads: 10, applications: 2, referrals: 1, sales: 1, existingCases: 0 });
    expect(getDailyTargets()).toEqual({
      leads: 10 * OFFICES.length,
      applications: 2 * OFFICES.length,
      referrals: 1 * OFFICES.length,
      sales: 1 * OFFICES.length,
      existingCases: 0,
    });
    expect(getWrittenWeeklyTargets()).toEqual({ mortgage: 200_000, insurance: 50_000 });
    expect(getTargetsProvenance()).toEqual({
      source: "upload",
      effectiveWeek: "2026-07-06",
      uploadedBy: "arman@capricornfinancial.co.uk",
      uploadedAt: "2026-07-06T09:00:00.000Z",
    });
    expect(getLastParsed()).toBe(parsed);
  });

  it("records an optional note (blended-source activations, e.g. the Datarails import)", () => {
    const parsed: ParsedTargets = {
      effectiveWeek: "2026-07-06",
      offices: Object.fromEntries(OFFICES.map((o) => [o.name, { leads: 50, applications: 10, referrals: 5, sales: 5 }])),
      writtenWeekly: { mortgage: 200_000, insurance: 50_000 },
    };
    activateTargets(parsed, "arman@capricornfinancial.co.uk", "2026-07-06T09:00:00.000Z", "Applications & Sales from Datarails import");
    expect(getTargetsProvenance().note).toBe("Applications & Sales from Datarails import");
  });

  it("carries the unconfirmed KPIs so an upload cannot claim targets it never supplied", () => {
    const parsed: ParsedTargets = {
      effectiveWeek: "2026-07-06",
      offices: Object.fromEntries(OFFICES.map((o) => [o.name, { leads: 50, applications: 10, referrals: 5, sales: 5 }])),
      writtenWeekly: { mortgage: 200_000, insurance: 50_000 },
    };
    // The real case this exists for: an import lands, so source flips to "upload", but Leads was
    // never in the file and is still our headcount estimate. Both facts have to survive together.
    activateTargets(parsed, "kyle@capricornfinancial.co.uk", "2026-08-18T08:12:36.127Z", "Sales & Referrals from Datarails import", ["leads"]);
    expect(getTargetsProvenance().source).toBe("upload");
    expect(getTargetsProvenance().unconfirmed).toEqual(["leads"]);
  });
});

describe("store — getCurrentAsParsedTargets", () => {
  it("reconstructs the placeholder constants as WEEKLY figures when nothing has been uploaded", () => {
    const data = getCurrentAsParsedTargets("2026-07-08");
    expect(data.effectiveWeek).toBe("2026-07-08");
    expect(data.writtenWeekly).toEqual(WRITTEN_WEEKLY_TARGET);
    expect(data.offices["Hammersmith"]).toEqual({
      leads: OFFICE_DAILY_TARGETS["Hammersmith"].leads * 5,
      applications: OFFICE_DAILY_TARGETS["Hammersmith"].applications * 5,
      referrals: OFFICE_DAILY_TARGETS["Hammersmith"].referrals * 5,
      sales: OFFICE_DAILY_TARGETS["Hammersmith"].sales * 5,
      existingCases: OFFICE_DAILY_TARGETS["Hammersmith"].existingCases * 5,
    });
  });

  it("returns the last activated upload unchanged once one exists", () => {
    const parsed: ParsedTargets = {
      effectiveWeek: "2026-07-06",
      offices: Object.fromEntries(OFFICES.map((o) => [o.name, { leads: 50, applications: 10, referrals: 5, sales: 5 }])),
      writtenWeekly: { mortgage: 200_000, insurance: 50_000 },
    };
    activateTargets(parsed, "arman@capricornfinancial.co.uk", "2026-07-06T09:00:00.000Z");
    expect(getCurrentAsParsedTargets("2026-07-08")).toBe(parsed);
  });
});
