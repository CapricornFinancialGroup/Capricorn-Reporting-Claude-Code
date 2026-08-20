import { describe, expect, it } from "vitest";
import type { DailyCount } from "./kpis.js";
import { cumulativeSeries, rankBoard } from "./datasets.js";
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

describe("rankBoard — a tie on the count is not a tie on anything that matters", () => {
  // The Protection Referred board for the four weeks to 2026-08-18 — the one Capricorn was looking at
  // when they asked for this. Three advisers on 3 referrals each printed as three sixth places, and two
  // other pairs printed as a shared 2nd and a shared 4th: "we've got some duplicates … we would rank
  // them based on the percentage converted." Frozen as a fixture, so the rule is pinned to the case it
  // came from rather than to whatever the rolling window holds today.
  const REFERRED = [
    { name: "Manny Esezobor", written: 12, referred: 8 },
    { name: "Sean Keller", written: 26, referred: 7 },
    { name: "Albano Toska", written: 25, referred: 7 },
    { name: "James Storer", written: 27, referred: 4 },
    { name: "Jules Pirko", written: 12, referred: 4 },
    { name: "Mason Elliott", written: 37, referred: 3 },
    { name: "Sam Lee", written: 14, referred: 3 },
    { name: "Toby Scott-Mason", written: 3, referred: 3 },
    { name: "Karina Seresoan", written: 29, referred: 2 },
    { name: "Tony Chryseliou", written: 19, referred: 2 },
  ];
  const pct = (a: { written: number; referred: number }) =>
    a.written > 0 ? Math.round((a.referred / a.written) * 100) : 0;

  it("settles the referred board on conversion percentage, leaving no shared ranks", () => {
    const ranked = rankBoard(REFERRED, (a) => a.referred, pct, 10);
    expect(ranked.map((r) => `${r.rank} ${r.row.name}`)).toEqual([
      "1 Manny Esezobor", //   8 · 67%
      "2 Albano Toska", //     7 · 28%  — ahead of Keller on 27%, who used to share 2nd with him
      "3 Sean Keller", //      7 · 27%
      "4 Jules Pirko", //      4 · 33%
      "5 James Storer", //     4 · 15%
      "6 Toby Scott-Mason", // 3 · 100% — the three sixth places, now settled
      "7 Sam Lee", //          3 · 21%
      "8 Mason Elliott", //    3 · 8%
      "9 Tony Chryseliou", //  2 · 11%
      "10 Karina Seresoan", // 2 · 7%
    ]);
  });

  it("still SHARES a rank when two rows are level on the measure AND the tie-break", () => {
    // Nothing left to separate them with. Inventing an order here would be a ranking the data cannot
    // support, so 1,2,2,4 survives for the case it was built for.
    const rows = [
      { name: "A", written: 10, referred: 4 }, // 4 · 40%
      { name: "B", written: 10, referred: 2 }, // 2 · 20%
      { name: "C", written: 20, referred: 4 }, // 4 · 20% — level with B on the rate, ahead on count
      { name: "D", written: 10, referred: 1 }, // 1 · 10%
    ];
    const ranked = rankBoard(rows, (a) => a.referred, pct, 10);
    expect(ranked.map((r) => [r.rank, r.row.name])).toEqual([[1, "A"], [2, "C"], [3, "B"], [4, "D"]]);
  });

  it("with no tie-break, keeps the plain competition ranking the other two boards use", () => {
    const rows = [
      { name: "Mason Elliott", written: 37 },
      { name: "Ross Murphy", written: 24 },
      { name: "Dale Shaw", written: 24 },
      { name: "Tony Chryseliou", written: 19 },
    ];
    const ranked = rankBoard(rows, (a) => a.written, () => 0, 10);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 2, 4]);
  });

  it("excludes zeroes and caps at the limit", () => {
    const rows = [
      { name: "A", written: 5, referred: 3 },
      { name: "B", written: 5, referred: 2 },
      { name: "C", written: 5, referred: 0 },
    ];
    expect(rankBoard(rows, (a) => a.referred, pct, 1).map((r) => r.row.name)).toEqual(["A"]);
    expect(rankBoard(rows, (a) => a.referred, pct, 10).map((r) => r.row.name)).toEqual(["A", "B"]);
  });
});
