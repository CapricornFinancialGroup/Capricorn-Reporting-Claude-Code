import { describe, expect, it } from "vitest";
import { CUMULATIVE_WEEK_SHARES, DAY_WEIGHTS } from "../../domain/targets.js";
import { mondayOf, mtdPacing, weeklyPacing } from "./pacing.js";

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

describe("weeklyPacing", () => {
  it("anchors the chase week on the Monday of the data-as-of day", () => {
    expect(mondayOf("2026-07-08")).toBe("2026-07-06"); // Wednesday → that week's Monday
    const ctx = weeklyPacing("2026-07-08");
    expect(ctx.windowStart).toBe("2026-07-06");
    expect(ctx.weekDays).toEqual(["2026-07-06", "2026-07-07", "2026-07-08", "2026-07-09", "2026-07-10"]);
    expect(ctx.fraction).toBeCloseTo(15 / 24); // expected by end of Wednesday = 62.5%
    expect(ctx.latestWorkingDay).toBe("2026-07-08"); // Wednesday itself
    expect(ctx.latestWorkingDayIndex).toBe(2);
  });

  it("folds a weekend anchor's day counter back to Friday", () => {
    const sun = weeklyPacing("2026-07-05"); // Sunday
    expect(sun.latestWorkingDay).toBe("2026-07-03"); // Friday of the just-finished week
    expect(sun.latestWorkingDayIndex).toBe(4);
  });

  it("Friday reaches 100% of the weekly target", () => {
    expect(weeklyPacing("2026-07-10").fraction).toBeCloseTo(1);
  });

  it("weekend data-as-of reads as the just-finished week, complete", () => {
    const sunday = weeklyPacing("2026-07-05");
    expect(sunday.windowStart).toBe("2026-06-29"); // the week that just ended
    expect(sunday.fraction).toBe(1);
  });

  it("Monday expects 20.83%", () => {
    expect(weeklyPacing("2026-07-06").fraction).toBeCloseTo(5 / 24);
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
