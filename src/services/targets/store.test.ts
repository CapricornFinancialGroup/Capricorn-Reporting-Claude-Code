import { beforeEach, describe, expect, it } from "vitest";
import { OFFICES } from "../../domain/offices.js";
import { DAILY_TARGETS, OFFICE_DAILY_TARGETS, REVENUE_DAILY_TARGET } from "../../domain/targets.js";
import type { ParsedTargets } from "./parse.js";
import {
  activateTargets,
  getDailyTargets,
  getLastParsed,
  getOfficeDailyTargets,
  getRevenueDailyTarget,
  getTargetsProvenance,
  resetTargetsForTest,
} from "./store.js";

beforeEach(() => resetTargetsForTest());

describe("store — seeded from placeholders, zero behaviour change before any upload", () => {
  it("returns the exact placeholder constants", () => {
    expect(getDailyTargets()).toEqual(DAILY_TARGETS);
    expect(getOfficeDailyTargets()).toEqual(OFFICE_DAILY_TARGETS);
    expect(getRevenueDailyTarget()).toBe(REVENUE_DAILY_TARGET);
    expect(getTargetsProvenance()).toEqual({ source: "placeholder", effectiveWeek: null, uploadedBy: null, uploadedAt: null });
    expect(getLastParsed()).toBeNull();
  });
});

describe("store — activateTargets", () => {
  it("converts uploaded WEEKLY figures to DAILY (÷5) and sums offices for the business-wide daily target", () => {
    const parsed: ParsedTargets = {
      effectiveWeek: "2026-07-06",
      offices: Object.fromEntries(OFFICES.map((o) => [o.name, { leads: 50, applications: 10, referrals: 5, sales: 5 }])),
      revenueWeekly: 250_000,
    };
    activateTargets(parsed, "arman@capricornfinancial.co.uk", "2026-07-06T09:00:00.000Z");

    expect(getOfficeDailyTargets()["Hammersmith"]).toEqual({ leads: 10, applications: 2, referrals: 1, sales: 1 });
    expect(getDailyTargets()).toEqual({
      leads: 10 * OFFICES.length,
      applications: 2 * OFFICES.length,
      referrals: 1 * OFFICES.length,
      sales: 1 * OFFICES.length,
    });
    expect(getRevenueDailyTarget()).toBe(50_000);
    expect(getTargetsProvenance()).toEqual({
      source: "upload",
      effectiveWeek: "2026-07-06",
      uploadedBy: "arman@capricornfinancial.co.uk",
      uploadedAt: "2026-07-06T09:00:00.000Z",
    });
    expect(getLastParsed()).toBe(parsed);
  });
});
