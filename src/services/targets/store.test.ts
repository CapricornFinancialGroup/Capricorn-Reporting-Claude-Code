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
    expect(getTargetsProvenance()).toEqual({ source: "placeholder", effectiveWeek: null, uploadedBy: null, uploadedAt: null });
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

    expect(getOfficeDailyTargets()["Hammersmith"]).toEqual({ leads: 10, applications: 2, referrals: 1, sales: 1 });
    expect(getDailyTargets()).toEqual({
      leads: 10 * OFFICES.length,
      applications: 2 * OFFICES.length,
      referrals: 1 * OFFICES.length,
      sales: 1 * OFFICES.length,
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
