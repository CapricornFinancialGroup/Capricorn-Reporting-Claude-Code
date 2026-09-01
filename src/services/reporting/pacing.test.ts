import { describe, expect, it } from "vitest";
import { BLENDED_CUMULATIVE_SHARES, CUMULATIVE_WEEK_SHARES, DAY_WEIGHTS, dayTarget, KPI_KEYS } from "../../domain/targets.js";
import { completeThrough, dataThroughDay, isTradingDay, isWeekendOnlyWeek, lastTradingDayOnOrBefore, mtdPacing, weekElapsedFraction, weeklyPacing } from "./pacing.js";

// The week is Sat..Fri, so index 0 = Sat, 1 = Sun, 2 = Mon ... 6 = Fri.
const [SAT, SUN, MON, TUE, WED, THU, FRI] = [0, 1, 2, 3, 4, 5, 6];

describe("weekly weights", () => {
  it("keeps Conor's weekday shape: Mon\u2013Thu equal, Friday 80% of a Mon\u2013Thu day", () => {
    for (const k of KPI_KEYS) {
      const w = DAY_WEIGHTS[k];
      expect(w[MON]).toBeCloseTo(w[TUE]);
      expect(w[TUE]).toBeCloseTo(w[WED]);
      expect(w[WED]).toBeCloseTo(w[THU]);
      expect(w[FRI] / w[MON], `${k}: Friday must stay at 80% of a Mon-Thu day`).toBeCloseTo(0.8);
    }
  });

  it("gives every KPI curve a total of exactly one week", () => {
    for (const k of KPI_KEYS) {
      expect(DAY_WEIGHTS[k].reduce((a, b) => a + b, 0), k).toBeCloseTo(1);
      expect(CUMULATIVE_WEEK_SHARES[k][FRI], k).toBeCloseTo(1);
    }
  });

  // The bug this guards: Saturday used to carry ZERO expected share for EVERY measure while Capricorn
  // traded through it (~36 leads a day), so its business counted towards the actual and nothing
  // towards the expectation. Kyle, 2026-08-04: "we do Saturday coverage which can result in circa 50+
  // leads". That must never come back for the measures that genuinely trade on a Saturday.
  it("still expects Saturday business where Capricorn actually does Saturday business", () => {
    for (const k of ["leads", "applications", "existingCases"] as const) {
      expect(DAY_WEIGHTS[k][SAT], `${k}: Saturday must carry a non-zero share`).toBeGreaterThan(0);
    }
  });

  // ...and the deliberate exception, pinned so nobody "fixes" it back. Kyle's ruling, 2026-08-25: "We
  // should weight it Monday to Friday for Protection." Twelve weeks to 21 Aug: 5 protection
  // opportunities and 1 written across twelve SATURDAYS, against 113–161 per weekday. A Saturday target
  // of 1–2 cases against an average of 0.4 and 0.08 had both protection cards reporting behind every
  // weekend, and the week-to-date reading "0 of 58" every Monday.
  it("expects NOTHING from protection at the weekend, on Kyle's ruling", () => {
    for (const k of ["referrals", "sales"] as const) {
      expect(DAY_WEIGHTS[k][SAT], `${k}: Saturday`).toBe(0);
      expect(DAY_WEIGHTS[k][SUN], `${k}: Sunday`).toBe(0);
      // Exactly zero, not merely small: dayTarget ROUNDS, so a share of even 1% comes back as a whole
      // case on a 58/week target and the false weekend verdict returns.
      expect(dayTarget(k, 58, SAT), `${k}: Saturday target`).toBe(0);
      expect(dayTarget(k, 58, SUN), `${k}: Sunday target`).toBe(0);
    }
  });

  it("gives protection's weekend share to its weekdays rather than losing it", () => {
    // Kyle was explicit that the weekly numbers do not change, only how they are spread — so the curve
    // must still sum to a full week and the weekdays must have absorbed the difference.
    for (const k of ["referrals", "sales"] as const) {
      expect(DAY_WEIGHTS[k].reduce((a, b) => a + b, 0), k).toBeCloseTo(1);
      expect(dayTarget(k, 58, MON), `${k}: Monday`).toBeGreaterThan(0);
      expect(DAY_WEIGHTS[k][MON], `${k}: Monday share vs leads`).toBeGreaterThan(DAY_WEIGHTS.leads[MON]);
    }
  });

  it("weights Saturday hardest for leads and lightest for written business, per the observed data", () => {
    // Leads arrive at the weekend (6.1% of the week); cases get progressed on weekdays (1.4%).
    expect(DAY_WEIGHTS.leads[SAT]).toBeCloseTo(0.06);
    expect(DAY_WEIGHTS.applications[SAT]).toBeCloseTo(0.015);
    expect(DAY_WEIGHTS.leads[SAT]).toBeGreaterThan(DAY_WEIGHTS.applications[SAT]);
  });

  it("keeps the weekday cumulative positions close to Conor's original table", () => {
    // Conor's Mon..Fri table was 20.83 / 41.67 / 62.5 / 83.33 / 100 with the weekend at zero. The
    // weekend now takes its real share, so the weekday steps shift down slightly - the SHAPE is
    // unchanged and Friday still closes the week at 100%.
    const pct = CUMULATIVE_WEEK_SHARES.applications.map((s) => Math.round(s * 10000) / 100);
    expect(pct[FRI]).toBe(100);
    expect(pct[MON]).toBeGreaterThan(18);
    expect(pct[MON]).toBeLessThan(24);
  });

  it("blends the four curves for the KPI-agnostic case", () => {
    expect(BLENDED_CUMULATIVE_SHARES[FRI]).toBeCloseTo(1);
    expect(BLENDED_CUMULATIVE_SHARES[SAT]).toBeCloseTo(
      KPI_KEYS.reduce((s, k) => s + DAY_WEIGHTS[k][SAT], 0) / KPI_KEYS.length,
    );
  });
});

describe("weeklyPacing - Capricorn's Sat-Fri reporting week, data drives the fraction", () => {
  it("spans all seven days of the week, Sat..Fri", () => {
    const ctx = weeklyPacing("2026-07-08", "2026-07-07"); // today Wed, data as of Tue
    expect(ctx.windowStart).toBe("2026-07-04"); // Saturday
    expect(ctx.weekDays).toEqual([
      "2026-07-04", "2026-07-05", "2026-07-06", "2026-07-07", "2026-07-08", "2026-07-09", "2026-07-10",
    ]);
    expect(ctx.windowEnd).toBe("2026-07-10"); // Friday
    expect(ctx.latestDay).toBe("2026-07-07");
    expect(ctx.latestDayIndex).toBe(TUE);
    expect(ctx.currentWeekPending).toBe(false);
  });

  it("paces each KPI on its OWN curve through the data-as-of day", () => {
    const ctx = weeklyPacing("2026-07-08", "2026-07-07"); // data through Tuesday
    for (const k of KPI_KEYS) {
      expect(ctx.fractionByKpi[k], k).toBeCloseTo(CUMULATIVE_WEEK_SHARES[k][TUE]);
    }
    // Leads are further through their week by Tuesday than written business is, because the weekend
    // they have already banked is worth more to them.
    expect(ctx.fractionByKpi.leads).toBeGreaterThan(ctx.fractionByKpi.applications);
  });

  // Saturday used to be skipped entirely: the headline tile jumped back to the previous Friday, so a
  // Saturday's trading was invisible on the wall all weekend.
  it("gives Saturday its own day tile instead of falling back to Friday", () => {
    const ctx = weeklyPacing("2026-07-05", "2026-07-04"); // today Sun, data through Sat
    expect(ctx.latestDay).toBe("2026-07-04");
    expect(ctx.latestDayIndex).toBe(SAT);
    expect(ctx.currentWeekPending).toBe(false); // the week HAS started - Saturday is a trading day
    expect(ctx.fractionByKpi.leads).toBeCloseTo(DAY_WEIGHTS.leads[SAT]);
  });

  it("treats the week as not started only when the data predates its Saturday", () => {
    const ctx = weeklyPacing("2026-07-06", "2026-07-03"); // today Mon, data still on last Friday
    expect(ctx.windowStart).toBe("2026-07-04");
    expect(ctx.currentWeekPending).toBe(true);
    expect(ctx.fraction).toBe(0);
    for (const k of KPI_KEYS) expect(ctx.fractionByKpi[k], k).toBe(0);
    expect(ctx.latestDay).toBe("2026-07-03"); // the tile shows last Friday
    expect(ctx.loadStart).toBe("2026-07-03"); // load reaches back to it
  });

  it("reaches back to windowStart once the week is under way, so weekend rows get fetched", () => {
    const ctx = weeklyPacing("2026-07-06", "2026-07-06"); // today Mon, data as of the same Mon
    expect(ctx.loadStart).toBe("2026-07-04"); // Saturday
  });

  it("Friday with same-day data reaches 100% on every KPI", () => {
    const ctx = weeklyPacing("2026-07-10", "2026-07-10");
    expect(ctx.fraction).toBeCloseTo(1);
    for (const k of KPI_KEYS) expect(ctx.fractionByKpi[k], k).toBeCloseTo(1);
  });
});

describe("weekElapsedFraction - shared by Momentum's extrapolation and the League's most-improved", () => {
  it("matches the KPI's own cumulative curve when a KPI is given", () => {
    expect(weekElapsedFraction("2026-07-08", "leads")).toBeCloseTo(CUMULATIVE_WEEK_SHARES.leads[WED]);
  });

  it("falls back to the blended curve when the measure is mixed", () => {
    expect(weekElapsedFraction("2026-07-08")).toBeCloseTo(BLENDED_CUMULATIVE_SHARES[WED]);
  });

  it("Friday reaches 100%", () => {
    expect(weekElapsedFraction("2026-07-10")).toBeCloseTo(1);
  });

  it("counts a Saturday as part of its week, not as zero", () => {
    // Was 0 for both Sat and Sun. Saturday trades, so it is no longer zero.
    expect(weekElapsedFraction("2026-07-11", "leads")).toBeCloseTo(DAY_WEIGHTS.leads[SAT]);
    expect(weekElapsedFraction("2026-07-11", "leads")).toBeGreaterThan(0);
    expect(weekElapsedFraction("2026-07-12", "referrals")).toBeCloseTo(DAY_WEIGHTS.referrals[SAT]);
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
// CRITICAL, headline day showing 1 lead at 11:19. The share reloads 4× daily, so today IS partly
// present — which is exactly why the cap is needed: partly present is not complete.
describe("dataThroughDay — the date the HEADER stamps, which is not the comparison boundary", () => {
  it("names today once today has business on it", () => {
    // Mon 24 Aug, the 11:15 load in. dataAsOf is Sunday; the ticker and the dotted chase segment both
    // already read Monday, so the header must too — this is the whole point of the field.
    expect(dataThroughDay("2026-08-23", "2026-08-24", 37)).toBe("2026-08-24");
  });

  it("stays on the complete day when today has loaded nothing yet", () => {
    // The ~06:00 load lands before anyone has written anything. Stamping today here would put a date
    // on the board with no business behind it.
    expect(dataThroughDay("2026-08-23", "2026-08-24", 0)).toBe("2026-08-23");
  });

  it("never claims a Sunday", () => {
    // Sunday is not a trading day, so there is no "today so far" to justify the date.
    expect(dataThroughDay("2026-08-22", "2026-08-23", 0)).toBe("2026-08-22");
    // Even if a stray row landed: the board shows no Sunday figure, so the stamp must not imply one.
    expect(dataThroughDay("2026-08-22", "2026-08-23", 4)).toBe("2026-08-22");
  });

  it("counts Saturday as a day the stamp can reach — the week is Sat–Fri", () => {
    expect(dataThroughDay("2026-08-21", "2026-08-22", 31)).toBe("2026-08-22");
  });

  it("never goes BACKWARDS from the complete day", () => {
    // If the lake ever reports a complete day at or beyond today, the stamp holds at the later date
    // rather than regressing — the header must not read older than the figures underneath it.
    expect(dataThroughDay("2026-08-24", "2026-08-24", 12)).toBe("2026-08-24");
    expect(dataThroughDay("2026-08-25", "2026-08-24", 12)).toBe("2026-08-25");
  });
});

describe("completeThrough — today is never a complete day, however many times the lake reloads", () => {
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
    // The 2026-07-30 regression. Before the cap the fraction came from THURSDAY, so 115 apps/wk
    // expected 95.8 by then and the board reported "−56". It must come from Wednesday.
    const asOf = completeThrough("2026-07-30", "2026-07-30");
    const ctx = weeklyPacing("2026-07-30", asOf);
    expect(ctx.dataAsOf).toBe("2026-07-29"); // Wednesday
    expect(ctx.latestDayIndex).toBe(4); // index 4 of Sat..Fri = Wednesday
    // Wednesday's expectation, on written business's own curve. Not the 62.5% of the old
    // weekend-is-worth-nothing curve — the weekend now takes its ~3.5% — but nowhere near Thursday's.
    const wed = ctx.fractionByKpi.applications;
    expect(Math.round(115 * wed)).toBeLessThan(80);
    expect(Math.round(115 * wed)).toBeGreaterThan(65);
    // The point of the test: Wednesday's expectation, never Thursday's.
    expect(wed).toBeLessThan(ctx.cumulativeShares.applications[5]); // < end of Thursday
  });

  // The "today so far" figure exists BECAUSE of the cap, and must never undo it: today is always
  // strictly after dataAsOf, so the separate [today, today] query can't overlap the chase window's
  // loaded rows. If this ever failed, today's part-day would be double-counted into wtd.
  it("always leaves today itself outside the chase's data window", () => {
    for (const today of ["2026-08-03", "2026-08-04", "2026-08-07", "2026-08-08"]) {
      for (const maxLeadDate of ["2026-07-20", "2026-08-03", "2026-08-04", "2026-08-31"]) {
        expect(completeThrough(maxLeadDate, today) < today).toBe(true);
      }
    }
  });
});

describe("isTradingDay - gates the 'today so far' figure", () => {
  it("counts Monday through SATURDAY", () => {
    // Mon 3 Aug 2026 -> Sat 8 Aug 2026. Saturday is a trading day (Kyle 2026-08-04): ~36 leads.
    for (const d of ["2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07", "2026-08-08"]) {
      expect(isTradingDay(d), d).toBe(true);
    }
  });

  it("excludes only Sunday, which runs 0-10 leads", () => {
    expect(isTradingDay("2026-08-09")).toBe(false); // Sun
  });
});

// The 2026-08-10 report: "I don't think this is refreshing 5 times a day as the below figures are
// completely off? Appears this has gotten worse?" Market Momentum was leading with W33 to Sun 9 Aug
// — 1 mortgage written, 43 leads, −92.9% — because the Sat–Fri week had only its weekend so far.
// Nothing was stale and nothing was miscounted; a weekend was being presented as a week.
describe("isWeekendOnlyWeek", () => {
  it("holds the headline back on Saturday and Sunday", () => {
    expect(isWeekendOnlyWeek("2026-08-08"), "Sat 8 Aug — the week is one day old").toBe(true);
    expect(isWeekendOnlyWeek("2026-08-09"), "Sun 9 Aug — the exact day Kyle screenshotted").toBe(true);
  });

  it("releases it once Monday is complete", () => {
    expect(isWeekendOnlyWeek("2026-08-10"), "Mon 10 Aug complete — a trading day is in").toBe(false);
    expect(isWeekendOnlyWeek("2026-08-14"), "Fri 14 Aug — the week is done").toBe(false);
  });

  it("is false on every weekday of the week", () => {
    for (const d of ["2026-08-10", "2026-08-11", "2026-08-12", "2026-08-13", "2026-08-14"]) {
      expect(isWeekendOnlyWeek(d), d).toBe(false);
    }
  });

  it("holds on the FOLLOWING Saturday too — each new week starts the guard again", () => {
    expect(isWeekendOnlyWeek("2026-08-15")).toBe(true);
  });
});

describe("the judged day is never a Sunday", () => {
  // The live regression, 2026-08-24. `dataAsOf` is capped at yesterday, so on a Monday it IS Sunday —
  // and Sunday runs ~5 cases against a leads target of 9. The board opened the week reporting
  // "0 vs 9 · CRITICAL" for nobody working on a Sunday.
  it("puts Monday's judged day on Saturday, not Sunday", () => {
    const ctx = weeklyPacing("2026-08-24", "2026-08-23"); // Mon, dataAsOf = Sun
    expect(ctx.dataAsOf).toBe("2026-08-23"); // the week still measures through Sunday…
    expect(ctx.latestDay).toBe("2026-08-22"); // …but Saturday is the day that gets judged
    expect(ctx.latestDayIndex).toBe(0); // index 0 of Sat..Fri
  });

  it("leaves Saturday alone — it is a trading day and earns its own tile", () => {
    const ctx = weeklyPacing("2026-08-23", "2026-08-22"); // Sun, dataAsOf = Sat
    expect(ctx.latestDay).toBe("2026-08-22");
    expect(ctx.latestDayIndex).toBe(0);
  });

  it("leaves every weekday alone", () => {
    // Tue..Sat dataAsOf values across one week, each already a trading day.
    for (const [today, asOf, idx] of [
      ["2026-08-19", "2026-08-18", 3], // Wed, judged Tue
      ["2026-08-20", "2026-08-19", 4], // Thu, judged Wed
      ["2026-08-21", "2026-08-20", 5], // Fri, judged Thu
      ["2026-08-22", "2026-08-21", 6], // Sat, judged Fri
    ] as Array<[string, string, number]>) {
      const ctx = weeklyPacing(today, asOf);
      expect(ctx.latestDay).toBe(asOf);
      expect(ctx.latestDayIndex).toBe(idx);
    }
  });

  it("does not let the weekend skip pull the day out of the loaded window", () => {
    // `loadStart` has to still reach the judged day, or its rows are never fetched and the tile reads
    // zero for a different reason entirely.
    const ctx = weeklyPacing("2026-08-24", "2026-08-23");
    expect(ctx.loadStart <= ctx.latestDay).toBe(true);
  });

  it("walks back at most one day, since Sunday is the only non-trading day", () => {
    expect(lastTradingDayOnOrBefore("2026-08-23")).toBe("2026-08-22"); // Sun -> Sat
    for (const d of ["2026-08-22", "2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28"]) {
      expect(lastTradingDayOnOrBefore(d)).toBe(d);
    }
  });
});

describe("isTradingDay — a bank holiday is not one either", () => {
  it("excludes the summer bank holiday, Mon 31 Aug 2026", () => {
    expect(isTradingDay("2026-08-31")).toBe(false);
  });

  it("still counts the ordinary Monday either side of it", () => {
    expect(isTradingDay("2026-08-24")).toBe(true);
    expect(isTradingDay("2026-09-07")).toBe(true);
  });

  it("keeps Saturday a trading day and Sunday not", () => {
    expect(isTradingDay("2026-08-29")).toBe(true); // Saturday
    expect(isTradingDay("2026-08-30")).toBe(false); // Sunday
  });

  it("walks back PAST a bank holiday to find the last day that traded", () => {
    // Mon 31 Aug looking back lands on Sat 29 Aug: Monday was the holiday, Sunday never trades. This
    // is what stops the headline day tile handing a closed Monday a full Monday target.
    expect(lastTradingDayOnOrBefore("2026-08-31")).toBe("2026-08-29");
  });

  it("stops the week-to-date expectation counting a closed day", () => {
    // Through Mon 31 Aug the leads curve stands at the two open days only — Sat 6% + Sun 1.5%.
    expect(weekElapsedFraction("2026-08-31", "leads")).toBeCloseTo(0.075, 10);
    // The equivalent Monday a week earlier is untouched: weekend plus a full Monday.
    expect(weekElapsedFraction("2026-08-24", "leads")).toBeCloseTo(0.075 + (0.925 * 5) / 24, 10);
  });
});
