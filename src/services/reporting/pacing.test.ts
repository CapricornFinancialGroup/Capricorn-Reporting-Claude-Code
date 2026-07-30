import { describe, expect, it } from "vitest";
import { CUMULATIVE_WEEK_SHARES, DAY_WEIGHTS } from "../../domain/targets.js";
import { completeThrough, mtdPacing, weekElapsedFraction, weeklyPacing } from "./pacing.js";

describe("weekly weights (Conor's principles)", () => {
  it("Mon–Thu carry 20.83% each, Friday 16.67% (80% of a Mon–Thu day)", () => {
    expect(DAY_WEIGHTS[0]).toBeCloseTo(5 / 24);
    expect(DAY_WEIGHTS[4]).toBeCloseTo(4 / 24);
    expect(DAY_WEIGHTS[4] / DAY_WEIGHTS[0]).toBeCloseTo(0.8);
    expect(DAY_WEIGHTS.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
  });

  it("cumulative expected positions match the spec table", () => {
    const pct = CUMULATIVE_WEEK_SHARES.map((s) => Math.round(s * 10000) / 100);
    expect(pct).toEqual([20.83, 41.67, 62.5, 83.33, 100]);
  });
});

describe("weeklyPacing — Capricorn's Sat–Fri reporting week, data drives the fraction", () => {
  it("mid-week: today Wed, data through Tue → this week, expected = end of Tue (41.67%)", () => {
    const ctx = weeklyPacing("2026-07-08", "2026-07-07"); // today Wed, data as of Tue
    expect(ctx.windowStart).toBe("2026-07-04"); // Saturday starting THIS Sat–Fri week
    expect(ctx.weekDays).toEqual(["2026-07-06", "2026-07-07", "2026-07-08", "2026-07-09", "2026-07-10"]);
    expect(ctx.windowEnd).toBe("2026-07-10"); // Friday — the window leads with the weekend
    expect(ctx.fraction).toBeCloseTo(10 / 24); // through Tuesday
    expect(ctx.currentWeekPending).toBe(false);
    expect(ctx.latestWorkingDay).toBe("2026-07-07"); // day counter = Tuesday (has data)
    expect(ctx.latestWorkingDayIndex).toBe(1);
  });

  it("early Monday: today Mon, data only through Sun → current week is pending, fraction 0", () => {
    const ctx = weeklyPacing("2026-07-06", "2026-07-05"); // today Mon, data as of Sun
    expect(ctx.windowStart).toBe("2026-07-04"); // the Saturday that led into this Mon
    expect(ctx.fraction).toBe(0); // nothing loaded for this week's working days yet
    expect(ctx.currentWeekPending).toBe(true);
    expect(ctx.latestWorkingDay).toBe("2026-07-03"); // day counter falls back to last Friday
    expect(ctx.latestWorkingDayIndex).toBe(4);
    expect(ctx.loadStart).toBe("2026-07-03"); // load must reach back to the fallback day
  });

  it("early Saturday, no weekday data yet: still falls back to last Friday, not this week's Saturday", () => {
    const ctx = weeklyPacing("2026-07-04", "2026-07-04"); // today Sat, data as of the same Sat
    expect(ctx.windowStart).toBe("2026-07-04"); // Saturday anchors its own week
    expect(ctx.currentWeekPending).toBe(true); // no weekday data yet
    expect(ctx.loadStart).toBe("2026-07-03"); // latestWorkingDay (last Fri) is still before windowStart
  });

  it("Monday once weekday data lands: loadStart reaches back to windowStart (Saturday) so weekend rows get folded in, even though the day counter itself is a weekday", () => {
    const ctx = weeklyPacing("2026-07-06", "2026-07-06"); // today Mon, data as of the same Mon
    expect(ctx.windowStart).toBe("2026-07-04"); // Saturday
    expect(ctx.latestWorkingDay).toBe("2026-07-06"); // Monday itself has data
    expect(ctx.loadStart).toBe("2026-07-04"); // load-bearing: reaches back past Monday to Saturday
  });

  it("Friday with same-day data reaches 100%", () => {
    expect(weeklyPacing("2026-07-10", "2026-07-10").fraction).toBeCloseTo(1);
  });
});

describe("weekElapsedFraction — shared by Momentum's extrapolation and the League's most-improved", () => {
  it("Wednesday matches the cumulative curve", () => {
    expect(weekElapsedFraction("2026-07-08")).toBeCloseTo(15 / 24); // Wed
  });

  it("Friday reaches 100%", () => {
    expect(weekElapsedFraction("2026-07-10")).toBeCloseTo(1);
  });

  it("a leading weekend counts the week as NOT yet started (flipped from the old trailing-weekend model)", () => {
    expect(weekElapsedFraction("2026-07-11")).toBe(0); // Sat
    expect(weekElapsedFraction("2026-07-12")).toBe(0); // Sun
  });
});

describe("mtdPacing (month-window screens)", () => {
  it("anchors the month window on the data-as-of day", () => {
    const ctx = mtdPacing("2026-07-05");
    expect(ctx.windowStart).toBe("2026-07-01");
    expect(ctx.windowEnd).toBe("2026-07-31");
    expect(ctx.workingDaysElapsed).toBe(3);
    expect(ctx.workingDaysTotal).toBe(23);
    expect(ctx.fraction).toBeCloseTo(3 / 23);
  });

  it("caps the fraction at 1 on the final day", () => {
    expect(mtdPacing("2026-07-31").fraction).toBe(1);
  });
});

// Regression: the 2026-07-30 incident. One lead dated "today" pulled MAX(LeadDate) forward, so the
// board paced Wednesday's data against Thursday's expectation and reported the firm a full day of
// target further behind than it was — leads 351 vs an expected 527, applications 40 vs 96, both
// CRITICAL, headline day showing 1 lead at 11:19. The lake is a nightly build: today is never
// complete.
describe("completeThrough — today is never a complete day in a nightly lake", () => {
  it("caps a MAX(LeadDate) that has run ahead to today", () => {
    // Thu 30 Jul held exactly 1 lead; every other fact stopped at Wed 29 Jul.
    expect(completeThrough("2026-07-30", "2026-07-30")).toBe("2026-07-29");
  });

  it("never trusts a future-dated lead either", () => {
    expect(completeThrough("2026-08-05", "2026-07-30")).toBe("2026-07-29");
  });

  it("leaves a genuinely lagging lake alone (load has not run yet)", () => {
    expect(completeThrough("2026-07-27", "2026-07-30")).toBe("2026-07-27");
  });

  it("accepts yesterday exactly", () => {
    expect(completeThrough("2026-07-29", "2026-07-30")).toBe("2026-07-29");
  });

  it("keeps the pacing fraction on the day the data actually covers", () => {
    // Before the fix: fraction came from Thu (83.33%). After: Wed (62.5%).
    const asOf = completeThrough("2026-07-30", "2026-07-30");
    const ctx = weeklyPacing("2026-07-30", asOf);
    expect(ctx.dataAsOf).toBe("2026-07-29");
    expect(Math.round(ctx.fraction * 10000) / 100).toBeCloseTo(62.5, 1);
    // 115 apps/wk × 62.5% = 71.9 expected, not the 95.8 that produced "−56".
    expect(Math.round(115 * ctx.fraction)).toBe(72);
  });
});
