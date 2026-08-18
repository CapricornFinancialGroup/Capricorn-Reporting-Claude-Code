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
  noneCaptured,
  resetTargetsForTest,
} from "./store.js";

beforeEach(() => resetTargetsForTest());

describe("store — seeded from placeholders, zero behaviour change before any upload", () => {
  it("returns the exact placeholder constants", () => {
    expect(getDailyTargets()).toEqual(DAILY_TARGETS);
    expect(getOfficeDailyTargets()).toEqual(OFFICE_DAILY_TARGETS);
    expect(getWrittenWeeklyTargets()).toEqual(WRITTEN_WEEKLY_TARGET);
    expect(getTargetsProvenance()).toEqual({ source: "placeholder", effectiveWeek: null, uploadedBy: null, uploadedAt: null, captured: noneCaptured() });
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
      note: undefined,
      // No `captured` argument = this upload asserts nothing about which figures it supplied.
      captured: noneCaptured(),
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

  // The Targets page answers "which of these numbers are actually mine?" from this map. Kyle's
  // Datarails file carries Applications/Protection/Revenue but never Leads, so a successful upload
  // legitimately leaves Leads on our placeholder — the distinction he read as a failed upload.
  it("carries a figure's provenance forward when a later upload does not supply it", () => {
    const offices = Object.fromEntries(OFFICES.map((o) => [o.name, { leads: 50, applications: 10, referrals: 5, sales: 5 }]));
    const parsed: ParsedTargets = { effectiveWeek: "2026-07-04", offices, writtenWeekly: { mortgage: 200_000, insurance: 50_000 } };

    activateTargets(parsed, "arman@capricornfinancial.co.uk", "2026-07-04T09:00:00.000Z", undefined, { applications: true, sales: true, referrals: true });
    expect(getTargetsProvenance().captured).toEqual({ leads: false, applications: true, referrals: true, sales: true, written: false });

    // A written-only import next week must not demote Applications back to "placeholder": its value
    // carried forward, so its provenance does too.
    activateTargets(parsed, "arman@capricornfinancial.co.uk", "2026-07-11T09:00:00.000Z", undefined, { written: true });
    expect(getTargetsProvenance().captured).toEqual({ leads: false, applications: true, referrals: true, sales: true, written: true });
  });

  it("erases the map for an upload that predates it, rather than claiming every figure is a placeholder", () => {
    const offices = Object.fromEntries(OFFICES.map((o) => [o.name, { leads: 50, applications: 10, referrals: 5, sales: 5 }]));
    const parsed: ParsedTargets = { effectiveWeek: "2026-07-04", offices, writtenWeekly: { mortgage: 200_000, insurance: 50_000 } };
    activateTargets(parsed, "arman@capricornfinancial.co.uk", "2026-07-04T09:00:00.000Z", undefined, null);
    expect(getTargetsProvenance().captured).toBeNull();
  });

  // An upload outlives the office roster it was written against — Kyle's 15 Aug file still carries a
  // Dubai row, and Dubai was retired on 2026-08-18. A retired office must not contribute to the
  // group target, or the group stops equalling the offices shown beneath it.
  it("excludes offices no longer on the roster from the group total", () => {
    const offices: Record<string, { leads: number; applications: number; referrals: number; sales: number }> = {
      ...Object.fromEntries(OFFICES.map((o) => [o.name, { leads: 50, applications: 10, referrals: 5, sales: 5 }])),
      Dubai: { leads: 500, applications: 100, referrals: 50, sales: 50 },
    };
    const parsed: ParsedTargets = { effectiveWeek: "2026-07-04", offices, writtenWeekly: { mortgage: 200_000, insurance: 50_000 } };
    activateTargets(parsed, "arman@capricornfinancial.co.uk", "2026-07-04T09:00:00.000Z");
    expect(getDailyTargets().leads).toBe(10 * OFFICES.length);
    expect(getDailyTargets().applications).toBe(2 * OFFICES.length);
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
