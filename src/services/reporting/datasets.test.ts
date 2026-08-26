import { describe, expect, it } from "vitest";
import type { DailyCount } from "./kpis.js";
import { cumulativeSeries, officeStatus, pctToPace, rankBoard, withDaybreaks } from "./datasets.js";
import type { WeeklyPacingContext } from "./pacing.js";
import type { KpiTargets } from "./kpis.js";
import type { FeedItem } from "./datasets.js";
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

// The ticker's header carried a single date until 2026-08-25, which stood over every item as though
// nothing newer existed — and on a Tuesday morning, when today holds no events yet, it read as a board
// a day behind. Capricorn: "just have a ticker running across." The date now belongs to a marker drawn
// where the day actually changes.
describe("withDaybreaks — the strip names a day only where the day changes", () => {
  const ev = (when: string | null, text = "e"): FeedItem =>
    ({ kind: "application", icon: "H", text, accent: "none", when });
  const ms = (text = "m"): FeedItem =>
    ({ kind: "milestone", icon: "T", text, accent: "none", when: null });
  const marks = (items: FeedItem[]) => withDaybreaks(items).filter((i) => i.kind === "daybreak");

  it("emits NOTHING when the strip opens on today — the busy-afternoon case", () => {
    expect(marks([ev(null), ev(null), ev(null)])).toEqual([]);
  });

  it("marks the FRONT when today has no events and the strip opens on yesterday", () => {
    // The quiet-morning case, and the whole reason a marker still exists: without it the wall would
    // scroll yesterday's business with nothing saying so.
    const m = marks([ev("Mon 24 Aug"), ev("Mon 24 Aug")]);
    expect(m).toHaveLength(1);
    expect(m[0].text).toBe("Mon 24 Aug");
    expect(withDaybreaks([ev("Mon 24 Aug")])[0].kind).toBe("daybreak");
  });

  it("marks the crossing point once when today's events run out mid-strip", () => {
    const m = marks([ev(null), ev(null), ev("Mon 24 Aug"), ev("Mon 24 Aug")]);
    expect(m).toHaveLength(1);
    expect(m[0].text).toBe("Mon 24 Aug");
  });

  it("does not let a milestone between two same-day events print a second marker", () => {
    // Milestones carry when:null. Treating one as a day change would stamp the date again every fourth
    // item, since that is how often a milestone is interleaved.
    expect(marks([ev("Mon 24 Aug"), ms(), ev("Mon 24 Aug"), ms(), ev("Mon 24 Aug")])).toHaveLength(1);
  });

  it("keeps every original item, in order", () => {
    const input = [ev(null, "a"), ms("b"), ev("Mon 24 Aug", "c")];
    const kept = withDaybreaks(input).filter((i) => i.kind !== "daybreak");
    expect(kept.map((i) => i.text)).toEqual(["a", "b", "c"]);
  });

  it("handles an empty feed without inventing a marker", () => {
    expect(withDaybreaks([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Office Run Chase — ranking and status on sub-unit targets
// ---------------------------------------------------------------------------

/** Expected-by-now fractions as at Wed 26 Aug 2026 (data through Tue 25), from the live payload:
 *  leads 291/633, applications 49/113, protection 24/58 under Kyle's Mon–Fri weighting. */
const FRAC_WED = {
  leads: 291 / 633,
  applications: 49 / 113,
  referrals: 24 / 58,
  sales: 24 / 58,
  existingCases: 0,
} as unknown as WeeklyPacingContext["fractionByKpi"];

const CTX_WED = { fractionByKpi: FRAC_WED } as unknown as WeeklyPacingContext;

/** Daily office targets → the shape pctToPace takes (it multiplies by 5 itself). */
function daily(leads: number, applications: number, referrals: number, sales: number): KpiTargets {
  return { leads, applications, referrals, sales, existingCases: 0 } as KpiTargets;
}

describe("pctToPace — a target expecting less than one case gets no vote", () => {
  // Singapore, 26 Aug: leads 9 of 27/wk, apps 3 of 4/wk, refs 0 of 1/wk, sales 0 of 1/wk. The two
  // protection legs expect 0.41 cases by Wednesday — unreachable, and scored as outright zeros.
  const SG_TARGETS = daily(5.4, 0.8, 0.2, 0.2);
  const SG_WTD = { leads: 9, applications: 3, referrals: 0, sales: 0, existingCases: 0 } as KpiTargets;

  it("drops the sub-unit legs instead of scoring them zero", () => {
    // Expectations: leads 12.4, apps 1.73 — both count. Refs/sales 0.41 each — neither does.
    // Leads 9/12.4 = 0.73, apps 3/1.73 = 1.73 capped to 1.00 → 86%.
    expect(pctToPace(SG_WTD, SG_TARGETS, CTX_WED)).toBe(86);
  });

  it("is the fix for the 61% it read before — two of the four misses were not yet missable", () => {
    // The old rule admitted any expectation above zero, so 0/0.41 twice halved the score.
    const oldWay = (() => {
      const ratios: number[] = [];
      for (const k of ["leads", "applications", "referrals", "sales"] as const) {
        const expected = SG_TARGETS[k] * 5 * FRAC_WED[k];
        if (expected > 0) ratios.push(SG_WTD[k] / expected);
      }
      return Math.round((ratios.reduce((a, b) => a + b, 0) / ratios.length) * 100);
    })();
    expect(oldWay).toBe(61);
  });

  it("returns null when NO KPI is big enough to rank on, so the office is left unranked", () => {
    const tiny = daily(0.2, 0.1, 0.1, 0.1); // whole-week expectations well under one case
    const wtd = { leads: 1, applications: 0, referrals: 0, sales: 0, existingCases: 0 } as KpiTargets;
    expect(pctToPace(wtd, tiny, CTX_WED)).toBeNull();
  });

  it("excludes nothing for an office whose every target is material", () => {
    // Hammersmith: every leg expects tens or hundreds. 0.68 + 1.00 (capped from 1.28) + 0.81 + 0.59.
    const hs = daily(98, 18, 9, 9);
    const wtd = { leads: 154, applications: 50, referrals: 15, sales: 11, existingCases: 0 } as KpiTargets;
    expect(pctToPace(wtd, hs, CTX_WED)).toBe(77);
  });
});

describe("pctToPace — beating a small target cannot carry the office", () => {
  // THE 2026-08-26 WALL. Newmarket: 1 lead of 36/wk (expects 16.6), 7 applications of 3/wk
  // (expects 1.3), no protection target at all. It was CHAMPION of the firm at 272% of pace while
  // its own leads tile read CRITICAL, and Hammersmith — doing the overwhelming majority of the
  // business — ranked third.
  const NM_TARGETS = daily(7.2, 0.6, 0, 0);
  const NM_WTD = { leads: 1, applications: 7, referrals: 0, sales: 0, existingCases: 0 } as KpiTargets;

  it("scores Newmarket on what it delivered, not on the ratio arithmetic of a 1.3-case target", () => {
    // 0.06 for leads + 1.00 for applications (capped from 5.38) → 53%.
    expect(pctToPace(NM_WTD, NM_TARGETS, CTX_WED)).toBe(53);
  });

  it("puts it BELOW the office doing most of the business, which is the whole point", () => {
    const hs = daily(98, 18, 9, 9);
    const hsWtd = { leads: 154, applications: 50, referrals: 15, sales: 11, existingCases: 0 } as KpiTargets;
    const newmarket = pctToPace(NM_WTD, NM_TARGETS, CTX_WED) ?? 0;
    const hammersmith = pctToPace(hsWtd, hs, CTX_WED) ?? 0;
    expect(newmarket).toBeLessThan(hammersmith);
  });

  it("was the other way round under the uncapped mean — 272% against 84%", () => {
    const uncapped = (wtd: KpiTargets, tg: KpiTargets) => {
      const r: number[] = [];
      for (const k of ["leads", "applications", "referrals", "sales"] as const) {
        const expected = tg[k] * 5 * FRAC_WED[k];
        if (expected > 0) r.push(wtd[k] / expected);
      }
      return Math.round((r.reduce((a, b) => a + b, 0) / r.length) * 100);
    };
    const hs = daily(98, 18, 9, 9);
    const hsWtd = { leads: 154, applications: 50, referrals: 15, sales: 11, existingCases: 0 } as KpiTargets;
    expect(uncapped(NM_WTD, NM_TARGETS)).toBe(272);
    expect(uncapped(hsWtd, hs)).toBe(84);
  });
});

describe("officeStatus — CRITICAL is denominated in cases, not percentage points", () => {
  const critical = [{ status: "critical" as const }];
  const notCritical = [{ status: "behind" as const }, { status: "ahead" as const }];

  it("says critical when a KPI has earned it on its own figures", () => {
    // Shanghai, 26 Aug: 0 leads against 4 expected — a real collapse, and it should shout.
    expect(officeStatus(0, critical)).toBe("critical");
  });

  it("says BEHIND, not critical, when no single KPI is in crisis", () => {
    // THE BUG THIS PINS: officeStatus passed `pct` (percentage points) into chaseStatus, whose
    // critical guard is "at least two whole cases short". `100 - pct >= 2` is true for any office
    // under 98%, so the guard never fired and everything below 60% of pace read CRITICAL however
    // small its target. One rule, stated once, in cases.
    expect(officeStatus(6, notCritical)).toBe("behind");
    expect(officeStatus(0, notCritical)).toBe("behind");
  });

  it("does not let one failing leg drag a broadly-delivering office into the red", () => {
    // Hammersmith is 77% of target with protection sales critical (11 of 19 expected). Critical
    // needs a low score AS WELL AS a critical leg, or the firm's main office shouts on one measure.
    expect(officeStatus(77, critical)).toBe("behind");
  });

  it("bands against a CEILING of 100, not a midpoint", () => {
    // Calibrated for the capped score. chaseStatus's ≥100 / ≥90 bands would put every office on the
    // 2026-08-26 wall in amber or red, the best of them at 86% of every target met.
    expect(officeStatus(100, notCritical)).toBe("ahead");
    expect(officeStatus(95, notCritical)).toBe("ahead");
    expect(officeStatus(86, notCritical)).toBe("on_pace"); // Singapore
    expect(officeStatus(84, notCritical)).toBe("behind");
  });

  it("has no verdict for an office with no rankable target", () => {
    expect(officeStatus(null, [])).toBe("on_pace");
  });

  it("ignores KPIs whose verdict was withheld for a sub-unit target", () => {
    expect(officeStatus(5, [{ status: null }, { status: "behind" as const }])).toBe("behind");
  });
});
