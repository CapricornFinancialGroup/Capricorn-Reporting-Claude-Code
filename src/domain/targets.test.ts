import { describe, expect, it } from "vitest";
import {
  BLENDED_CUMULATIVE_SHARES, CUMULATIVE_WEEK_SHARES, DAILY_TARGETS, DAY_WEIGHTS, KPI_KEYS,
  monthlyTarget, OFFICE_DAILY_TARGETS, TARGETED_KPI_KEYS, WEEK_DAY_NAMES, weeklyOfficeTarget,
  weeklyTarget, workingDaysElapsed, workingDaysInMonth,
} from "./targets.js";

describe("working-day maths", () => {
  it("counts working days in July 2026 (23 weekdays)", () => {
    expect(workingDaysInMonth("2026-07-15")).toBe(23);
  });

  it("counts elapsed working days through a Sunday (Jul 5 2026 → Wed–Fri = 3)", () => {
    expect(workingDaysElapsed("2026-07-05")).toBe(3);
  });

  it("elapsed equals total on the last day of the month", () => {
    expect(workingDaysElapsed("2026-07-31")).toBe(workingDaysInMonth("2026-07-31"));
  });

  it("derives the monthly target from the daily target", () => {
    expect(monthlyTarget(10, "2026-07-15")).toBe(230);
  });
});

// `existingCases` is TRACKED but UNTARGETED (Capricorn 2026-08-17 — they set no target for it, and
// inventing one is not ours to do). The failure mode this guards is quiet: paceStatus/chaseStatus both
// read "expected 0, actual > 0" as AHEAD, so an untargeted KPI paced against zero would sit on the
// office wall permanently bright green for beating a target that does not exist.
describe("untargeted KPIs are tracked, not chased", () => {
  it("keeps existingCases in KPI_KEYS but out of TARGETED_KPI_KEYS", () => {
    expect(KPI_KEYS).toContain("existingCases");
    expect(TARGETED_KPI_KEYS).not.toContain("existingCases");
    // Every targeted KPI must still be a real KPI.
    for (const k of TARGETED_KPI_KEYS) expect(KPI_KEYS).toContain(k);
  });

  it("carries a zero target everywhere, business-wide and per office", () => {
    expect(DAILY_TARGETS.existingCases).toBe(0);
    expect(weeklyTarget("existingCases")).toBe(0);
    for (const office of Object.keys(OFFICE_DAILY_TARGETS)) {
      expect(weeklyOfficeTarget(office, "existingCases"), office).toBe(0);
    }
  });

  it("excludes untargeted KPIs from the blended pace curve", () => {
    // The blend is what Momentum's partial-week extrapolation and the League's most-improved pace
    // against. Averaging in a KPI with no target would shift every one of those figures.
    const expected = WEEK_DAY_NAMES.map((_, i) =>
      TARGETED_KPI_KEYS.reduce((sum, k) => sum + CUMULATIVE_WEEK_SHARES[k][i], 0) / TARGETED_KPI_KEYS.length,
    );
    expect(BLENDED_CUMULATIVE_SHARES).toEqual(expected);
    // And it still ends at a full week.
    expect(BLENDED_CUMULATIVE_SHARES[6]).toBeCloseTo(1, 10);
  });

  it("still gives every KPI — targeted or not — a day curve that sums to a whole week", () => {
    for (const k of KPI_KEYS) {
      expect(DAY_WEIGHTS[k].reduce((a, b) => a + b, 0), k).toBeCloseTo(1, 10);
      expect(CUMULATIVE_WEEK_SHARES[k][6], k).toBeCloseTo(1, 10);
    }
  });
});
