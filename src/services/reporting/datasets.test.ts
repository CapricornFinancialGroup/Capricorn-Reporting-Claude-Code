import { describe, expect, it } from "vitest";
import type { DailyCount } from "./kpis.js";
import { cumulativeSeries } from "./datasets.js";
import { isoWeekNo } from "./trends.js";

const WEEK_DAYS = ["2026-07-06", "2026-07-07", "2026-07-08", "2026-07-09", "2026-07-10"]; // Mon..Fri

describe("cumulativeSeries — Sat–Fri reporting week folds a LEADING weekend into Monday", () => {
  it("weekend rows dated before Monday accumulate into the Monday point with zero special-casing", () => {
    const daily: DailyCount[] = [
      { d: "2026-07-04", n: 3 }, // Sat
      { d: "2026-07-05", n: 2 }, // Sun
      { d: "2026-07-06", n: 5 }, // Mon
      { d: "2026-07-07", n: 1 }, // Tue
    ];
    const series = cumulativeSeries(daily, WEEK_DAYS, "2026-07-07");
    expect(series[0]).toBe(10); // Sat(3) + Sun(2) + Mon(5)
    expect(series[1]).toBe(11); // + Tue(1)
  });

  it("stops (null) after the data-as-of day", () => {
    const daily: DailyCount[] = [{ d: "2026-07-06", n: 5 }];
    const series = cumulativeSeries(daily, WEEK_DAYS, "2026-07-07");
    expect(series[0]).toBe(5);
    expect(series[1]).toBe(5); // Tue has no rows, carries Monday's cumulative
    expect(series[2]).toBeNull(); // Wed is after asOf
    expect(series[3]).toBeNull();
    expect(series[4]).toBeNull();
  });

  it("a week with no weekend activity behaves exactly as before (regression check)", () => {
    const daily: DailyCount[] = [
      { d: "2026-07-06", n: 2 },
      { d: "2026-07-08", n: 4 },
    ];
    const series = cumulativeSeries(daily, WEEK_DAYS, "2026-07-10");
    expect(series).toEqual([2, 2, 6, 6, 6]);
  });
});

describe("isoWeekNo — real ISO-8601 week number, given a Monday", () => {
  it("matches a known ISO week (2026-07-06 is ISO week 28)", () => {
    expect(isoWeekNo("2026-07-06")).toBe(28);
  });

  it("handles the year-boundary case via the Thursday rule", () => {
    // Mon 2026-12-28's Thursday (2026-12-31) is still in ISO year 2026 → week 53.
    expect(isoWeekNo("2026-12-28")).toBe(53);
  });
});
