import { describe, expect, it } from "vitest";
import { dayRecordedShare } from "./data-quality.js";
import { tzHour } from "../services/reporting/pace.js";

// The load windows this curve is keyed to, measured in London over 1–21 Aug 2026:
//   08:21–09:07   11:58–12:51   14:53–15:33   17:51–18:29   20:49–21:22
describe("dayRecordedShare — how much of a day the data share is holding", () => {
  it("places each observed load window on the right step", () => {
    // Morning load: the day has barely started arriving.
    expect(dayRecordedShare(8)).toBeCloseTo(0.015);
    expect(dayRecordedShare(9)).toBeCloseTo(0.015);
    // Lunchtime load — the window straddles noon, and both halves must land on the same step or the
    // expectation would jump depending on whether the ETL ran at 11:58 or 12:05.
    expect(dayRecordedShare(11)).toBeCloseTo(0.113);
    expect(dayRecordedShare(12)).toBeCloseTo(0.113);
    expect(dayRecordedShare(13)).toBeCloseTo(0.113);
    // Mid-afternoon.
    expect(dayRecordedShare(14)).toBeCloseTo(0.333);
    expect(dayRecordedShare(15)).toBeCloseTo(0.333);
    // Late-afternoon load — the LAST of the day since the schedule changed on 2026-08-21. Around a
    // third of the day is still to arrive, on tomorrow morning's load or later, which is what
    // INPUT_LAG_SETTLE_DAYS is about.
    expect(dayRecordedShare(17)).toBeCloseTo(0.63);
    expect(dayRecordedShare(18)).toBeCloseTo(0.63);
    // Nothing loads after ~17:45 any more, so a late hour must hold the late-afternoon share and NOT
    // the retired 21:00 load's 88.5% — an evening viewer would otherwise be told five-sixths of the
    // day was in when only two-thirds was.
    expect(dayRecordedShare(20)).toBeCloseTo(0.63);
    expect(dayRecordedShare(23)).toBeCloseTo(0.63);
  });

  it("puts the new ~06:00 load on the morning step, not on a later one", () => {
    // The first load moved from ~08:45 to ~05:50 on 2026-08-21. It arrives before the business day,
    // so it can only hold less than the morning 1.5% — never more.
    expect(dayRecordedShare(5)).toBeCloseTo(0.015);
    expect(dayRecordedShare(6)).toBeCloseTo(0.015);
    expect(dayRecordedShare(10)).toBeCloseTo(0.015);
  });

  it("treats an unusually early load as the morning load, not as no load", () => {
    // 21 Aug 2026 opened with a one-off 06:21 outside every normal window. It holds a morning load's
    // worth of business, so it must not fall off the bottom of the curve.
    expect(dayRecordedShare(6)).toBeCloseTo(0.015);
    expect(dayRecordedShare(0)).toBeCloseTo(0.015);
  });

  it("withholds a share when there is no load stamp", () => {
    // No stamp means we cannot say which load we are on, and an expectation against an unknown
    // denominator is worse than none — the caller prints no comparison at all.
    expect(dayRecordedShare(null)).toBeNull();
    expect(dayRecordedShare(Number.NaN)).toBeNull();
  });

  it("never claims a whole day is in", () => {
    for (let h = 0; h < 24; h++) expect(dayRecordedShare(h)!).toBeLessThan(1);
  });

  it("is monotonic — the day cannot un-arrive as it goes on", () => {
    let prev = 0;
    for (let h = 0; h < 24; h++) {
      const s = dayRecordedShare(h)!;
      expect(s).toBeGreaterThanOrEqual(prev);
      prev = s;
    }
  });
});

describe("tzHour — the load stamp resolved in the reporting timezone", () => {
  it("reads a BST instant as London, not UTC (the hour that caused the whole confusion)", () => {
    // Kyle's 21 Aug load: 05:21Z is 06:21 in London. Read as UTC it would be hour 5; either way it is
    // the morning step here, but the same one-hour error on the noon load moves 11:58 to 10:58 and
    // would drop it a whole step.
    expect(tzHour(new Date("2026-08-21T05:21:52Z"), "Europe/London")).toBe(6);
    // The lunchtime load: 10:58Z = 11:58 London → step 2. As UTC it reads 10 → step 1, i.e. the
    // expectation would be 1.5% of the day instead of 11.3%.
    const noonLoad = new Date("2026-08-20T10:58:37Z");
    expect(tzHour(noonLoad, "Europe/London")).toBe(11);
    expect(dayRecordedShare(tzHour(noonLoad, "Europe/London"))).toBeCloseTo(0.113);
    expect(dayRecordedShare(noonLoad.getUTCHours())).toBeCloseTo(0.015); // the bug, for the record
  });

  it("reads a GMT instant with no offset applied", () => {
    expect(tzHour(new Date("2026-01-15T08:30:00Z"), "Europe/London")).toBe(8);
  });

  it("handles midnight without wrapping to 24", () => {
    expect(tzHour(new Date("2026-01-15T00:10:00Z"), "Europe/London")).toBe(0);
  });
});
