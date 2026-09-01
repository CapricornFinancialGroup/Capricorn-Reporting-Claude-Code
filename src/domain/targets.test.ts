import { describe, expect, it } from "vitest";
import {
  BLENDED_CUMULATIVE_SHARES, cumulativeSharesForWeek, CUMULATIVE_WEEK_SHARES, DAILY_TARGETS,
  DAY_WEIGHTS, dayTarget, dayWeightsForWeek, KPI_KEYS, monthlyTarget, OFFICE_DAILY_TARGETS,
  TARGETED_KPI_KEYS, WEEK_DAY_NAMES, weeklyOfficeTarget, weeklyTarget, workingDaysElapsed,
  workingDaysInMonth,
} from "./targets.js";
import { bankHolidaysBetween, isBankHoliday } from "./calendar.js";

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

// ---------------------------------------------------------------------------
// Bank holidays — a closed day carries no expectation, and its share moves
// ---------------------------------------------------------------------------

/** W36 2026 = Sat 29 Aug – Fri 4 Sep. Monday 31 Aug is the summer bank holiday. */
const W36 = ["2026-08-29", "2026-08-30", "2026-08-31", "2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04"];
/** W35 2026 = Sat 22 – Fri 28 Aug. No holiday — the control. */
const W35 = ["2026-08-22", "2026-08-23", "2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28"];
const NEVER_CLOSED = () => false;

describe("calendar — England & Wales bank holidays", () => {
  it("knows the summer bank holiday that started this", () => {
    expect(isBankHoliday("2026-08-31")).toBe(true);
  });

  it("does not think an ordinary Monday is one", () => {
    expect(isBankHoliday("2026-08-24")).toBe(false);
    expect(isBankHoliday("2026-09-07")).toBe(false);
  });

  it("carries the SUBSTITUTE day when a holiday lands on a weekend, not the holiday itself", () => {
    // Boxing Day 2026 is a Saturday; the office shuts on Monday 28th instead.
    expect(isBankHoliday("2026-12-26")).toBe(false);
    expect(isBankHoliday("2026-12-28")).toBe(true);
    // Christmas Day 2027 is a Saturday, Boxing Day the Sunday → Mon 27th and Tue 28th.
    expect(isBankHoliday("2027-12-25")).toBe(false);
    expect(isBankHoliday("2027-12-27")).toBe(true);
    expect(isBankHoliday("2027-12-28")).toBe(true);
  });

  it("lists the holidays inside a range, so a week can be described", () => {
    expect(bankHolidaysBetween("2026-08-29", "2026-09-04")).toEqual(["2026-08-31"]);
    expect(bankHolidaysBetween("2026-08-22", "2026-08-28")).toEqual([]);
  });
});

describe("dayWeightsForWeek — the closed day's work moves, it does not vanish", () => {
  it("gives a bank-holiday Monday no share at all", () => {
    for (const k of TARGETED_KPI_KEYS) {
      expect(dayWeightsForWeek(k, W36)[2]).toBe(0);
    }
  });

  it("STILL SUMS TO 1 — the weekly target is unchanged, only the day-by-day expectation", () => {
    // Kyle's own wording for the protection ruling, and the precedent this follows. Zeroing the day
    // without redistributing would quietly cut the week's commitment by a fifth.
    for (const k of TARGETED_KPI_KEYS) {
      const sum = dayWeightsForWeek(k, W36).reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1, 10);
      expect(cumulativeSharesForWeek(k, W36).at(-1)).toBeCloseTo(1, 10);
    }
  });

  it("moves the share onto the days that were open, weighted on Conor's 5:5:5:4", () => {
    // Tue/Wed/Thu each take 5 of the surviving 19 ratio points, Friday 4.
    const w = dayWeightsForWeek("referrals", W36); // weekend share is 0, so weekdays hold all of it
    expect(w[3]).toBeCloseTo(5 / 19, 10);
    expect(w[4]).toBeCloseTo(5 / 19, 10);
    expect(w[5]).toBeCloseTo(5 / 19, 10);
    expect(w[6]).toBeCloseTo(4 / 19, 10);
  });

  it("leaves the weekend share alone — Saturday is still a trading day", () => {
    expect(dayWeightsForWeek("leads", W36)[0]).toBeCloseTo(0.06, 10);
    expect(dayWeightsForWeek("leads", W36)[1]).toBeCloseTo(0.015, 10);
  });

  it("changes NOTHING in a week with no holiday in it", () => {
    for (const k of TARGETED_KPI_KEYS) {
      expect(dayWeightsForWeek(k, W35)).toEqual(dayWeightsForWeek(k, W35, NEVER_CLOSED));
      expect(dayWeightsForWeek(k, W35, NEVER_CLOSED)).toEqual(DAY_WEIGHTS[k]);
    }
  });

  it("keeps only the weekend when every weekday is shut, rather than inventing a curve", () => {
    // Degenerate and not reachable from the UK calendar, but a weekly target genuinely cannot be met
    // by an office that never opens, so the curve must sum to less than 1 rather than pretend.
    const shut = dayWeightsForWeek("leads", W36, () => true);
    expect(shut.slice(2)).toEqual([0, 0, 0, 0, 0]);
    expect(shut.reduce((a, b) => a + b, 0)).toBeCloseTo(0.075, 10);
  });
});

describe("THE 2026-08-31 REGRESSION — 136 leads behind for a day nobody worked", () => {
  // Live board, Tue 1 Sep, W36 through Mon 31 Aug: leads 33 week-to-date against a 633 target.
  const LEADS_TARGET = 633;
  const MON = 2;

  it("expected 169 leads by the end of a bank-holiday Monday", () => {
    const before = cumulativeSharesForWeek("leads", W36, NEVER_CLOSED)[MON];
    expect(Math.round(LEADS_TARGET * before)).toBe(169); // 33 actual → "BEHIND 136"
  });

  it("now expects 47 — the two days that were actually open", () => {
    const after = cumulativeSharesForWeek("leads", W36)[MON];
    expect(Math.round(LEADS_TARGET * after)).toBe(47); // 33 actual → "behind 14", which is believable
  });

  it("hands that Monday a day target of zero instead of 122 leads", () => {
    expect(dayTarget("leads", LEADS_TARGET, MON)).toBe(122);
    expect(dayTarget("leads", LEADS_TARGET, MON, W36)).toBe(0);
  });

  it("clears the false protection verdicts the same way", () => {
    // Referrals/sales are Mon–Fri only (Kyle 2026-08-25), so a bank-holiday Monday expected 12 of 58
    // and the cards read behind 10 and behind 12 on nothing.
    for (const k of ["referrals", "sales"] as const) {
      expect(Math.round(58 * cumulativeSharesForWeek(k, W36, NEVER_CLOSED)[MON])).toBe(12);
      expect(Math.round(58 * cumulativeSharesForWeek(k, W36)[MON])).toBe(0);
    }
  });
});
