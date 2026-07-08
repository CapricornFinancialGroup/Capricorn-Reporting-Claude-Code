// The pacing seam — the ONE place that decides "which week are we chasing, and how far through?".
//
//   • weeklyPacing (the run chase, per Conor's 2026-07-06 principles): Capricorn's own Sat–Fri
//     reporting week (`docs/data-dictionary.md`) containing today (business tz), chased against
//     the weekly target with WEIGHTED working days (Fri = 80% of a Mon–Thu day). The lake is a
//     nightly build, so early in the week the current week may hold little/no data yet — that's
//     expected; it fills as the nightly loads catch up.
//     `fraction` (expected-by-now) is measured through the latest current-week day that HAS data,
//     so it stays comparable to the actual. The headline day counter uses `latestWorkingDay` — the
//     most recent working day with data anywhere (falls back to last week early-Monday) so the
//     board is never blank.
//   • mtdPacing (month-to-date) — used for month-window screens (funnel volumes).
//
// If a true intraday feed (or the simulated "drip" mode) ever lands, it plugs in HERE — pages and
// datasets consume PacingContext and never know the cadence.

import { CUMULATIVE_WEEK_SHARES } from "../../domain/targets.js";
import { monthOf, shiftDays, weekStartOf } from "./trends.js";
import { workingDaysElapsed, workingDaysInMonth } from "../../domain/targets.js";

export interface PacingContext {
  /** The latest complete day loaded in the lake (YYYY-MM-DD) — the chase measures through this day. */
  dataAsOf: string;
  /** First day of the chase window (YYYY-MM-DD). */
  windowStart: string;
  /** Last day of the chase window (YYYY-MM-DD). */
  windowEnd: string;
  /** Chase fraction 0..1 — expected share of the window target achieved by end of dataAsOf. */
  fraction: number;
  /** Label for the NOW marker on pace charts, e.g. "Jul 5". */
  nowLabel: string;
}

function dow(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getUTCDay(); // 0=Sun … 6=Sat
}

/** How far through its Sat–Fri week `iso` is, by the same weighted day curve as the run chase
 *  (leading Sat/Sun = week not yet started, 0). The one seam for "is this week still in progress,
 *  and by how much" — anywhere that compares a current, possibly-partial week against a complete
 *  one (Momentum's trend, the League's most-improved) should extrapolate through this, not
 *  re-derive its own day-of-week math (two copies of this drifting apart would just reopen the
 *  "the numbers don't agree across screens" complaint Conor already raised once, 2026-07-07). */
export function weekElapsedFraction(iso: string): number {
  const isoDow = (dow(iso) + 1) % 7; // 0=Sat,1=Sun,2=Mon … 6=Fri
  return isoDow < 2 ? 0 : CUMULATIVE_WEEK_SHARES[isoDow - 2];
}

/** The most recent working day (Mon–Fri) on or before `iso`. */
export function latestWorkingDayOnOrBefore(iso: string): string {
  let d = iso;
  while (dow(d) === 0 || dow(d) === 6) d = shiftDays(d, -1);
  return d;
}

function shortLabel(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  const monthName = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1];
  return `${monthName} ${d}`;
}

export interface WeeklyPacingContext extends PacingContext {
  /** The five working days of the CURRENT week (Mon..Fri, YYYY-MM-DD). */
  weekDays: string[];
  /** Cumulative expected share of the weekly target by end of each working day (0..1). */
  cumulativeShares: number[];
  /** The headline day counter's working day — the most recent working day WITH data (≤ dataAsOf),
   *  which early in the week may be last week's Friday so the board is never blank. */
  latestWorkingDay: string;
  /** DAY_WEIGHTS index (0..4) of latestWorkingDay within ITS week — picks that day's target share. */
  latestWorkingDayIndex: number;
  /** True when the current week has no loaded data yet (e.g. Monday before the overnight load) —
   *  the day counter is then showing last week's last working day. */
  currentWeekPending: boolean;
  /** Earliest day the dataset layer must load to cover both the current week and the day counter. */
  loadStart: string;
}

/** Weighted CURRENT-week chase, Capricorn's Sat–Fri reporting week (`docs/data-dictionary.md`).
 *  `today` = current business date (drives which week); `dataAsOf` = latest complete lake day
 *  (drives how much data we actually have). */
export function weeklyPacing(today: string, dataAsOf: string): WeeklyPacingContext {
  const windowStart = weekStartOf(today); // Saturday
  const weekDays = Array.from({ length: 5 }, (_, i) => shiftDays(windowStart, i + 2)); // Mon..Fri
  const firstWorkingDay = weekDays[0]; // Monday-equivalent
  const friday = weekDays[4];

  // Expected-by-now: measured through the latest CURRENT-WEEK day that has data (≤ dataAsOf),
  // capped at Friday. Before any current-week weekday data exists (dataAsOf < Monday) → 0 — the
  // leading Sat/Sun of the window haven't started the working week yet.
  let fraction = 0;
  if (dataAsOf >= firstWorkingDay) {
    const inWeek = dataAsOf < friday ? dataAsOf : friday;
    fraction = weekElapsedFraction(inWeek);
  }

  // Headline day = most recent working day with data (falls back to last week early in this week).
  const latestWorkingDay = latestWorkingDayOnOrBefore(dataAsOf);
  const latestWorkingDayIndex = dow(latestWorkingDay) - 1; // Mon(1)→0 … Fri(5)→4

  return {
    dataAsOf,
    windowStart,
    windowEnd: shiftDays(windowStart, 6), // Friday — the window already leads with the weekend
    weekDays,
    cumulativeShares: [...CUMULATIVE_WEEK_SHARES],
    fraction,
    latestWorkingDay,
    latestWorkingDayIndex,
    currentWeekPending: dataAsOf < firstWorkingDay,
    // Load-bearing: reaching back to windowStart (Saturday) is what makes weekend rows actually
    // get fetched once the week is under way, not just the fallback day early on.
    loadStart: latestWorkingDay < windowStart ? latestWorkingDay : windowStart,
    nowLabel: shortLabel(dataAsOf),
  };
}

/** Month-to-date pacing (equal-weighted working days) — month-window screens. */
export function mtdPacing(dataAsOf: string): PacingContext & { workingDaysElapsed: number; workingDaysTotal: number } {
  const month = monthOf(dataAsOf);
  const elapsed = workingDaysElapsed(dataAsOf);
  const total = workingDaysInMonth(dataAsOf);
  return {
    dataAsOf,
    windowStart: month.from,
    windowEnd: month.to,
    workingDaysElapsed: elapsed,
    workingDaysTotal: total,
    fraction: total > 0 ? Math.min(1, elapsed / total) : 1,
    nowLabel: shortLabel(dataAsOf),
  };
}
