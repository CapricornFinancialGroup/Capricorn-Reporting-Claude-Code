// The pacing seam — the ONE place that decides "which week are we chasing, and how far through?".
//
//   • weeklyPacing (the run chase, per Conor's 2026-07-06 principles): the CURRENT calendar week
//     (Mon–Fri containing today, business tz), chased against the weekly target with WEIGHTED days
//     (Fri = 80% of a Mon–Thu day). The lake is a nightly build, so early in the week the current
//     week may hold little/no data yet — that's expected; it fills as the nightly loads catch up.
//     `fraction` (expected-by-now) is measured through the latest current-week day that HAS data,
//     so it stays comparable to the actual. The headline day counter uses `latestWorkingDay` — the
//     most recent working day with data anywhere (falls back to last week early-Monday) so the
//     board is never blank.
//   • mtdPacing (month-to-date) — used for month-window screens (funnel volumes).
//
// If a true intraday feed (or the simulated "drip" mode) ever lands, it plugs in HERE — pages and
// datasets consume PacingContext and never know the cadence.

import { CUMULATIVE_WEEK_SHARES } from "../../domain/targets.js";
import { monthOf, shiftDays } from "./trends.js";
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

const DAY_MS = 86_400_000;

function dow(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getUTCDay(); // 0=Sun … 6=Sat
}

/** Monday of the ISO week containing `iso`. */
export function mondayOf(iso: string): string {
  const d = dow(iso);
  const back = d === 0 ? 6 : d - 1;
  return new Date(new Date(`${iso}T00:00:00Z`).getTime() - back * DAY_MS).toISOString().slice(0, 10);
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

/** Weighted CURRENT-week chase. `today` = current business date (drives which week); `dataAsOf` =
 *  latest complete lake day (drives how much data we actually have). */
export function weeklyPacing(today: string, dataAsOf: string): WeeklyPacingContext {
  const monday = mondayOf(today);
  const weekDays = Array.from({ length: 5 }, (_, i) =>
    new Date(new Date(`${monday}T00:00:00Z`).getTime() + i * DAY_MS).toISOString().slice(0, 10),
  );
  const friday = weekDays[4];

  // Expected-by-now: measured through the latest CURRENT-WEEK day that has data (≤ dataAsOf),
  // capped at Friday. Before any current-week data exists (dataAsOf < Monday) → 0.
  let fraction = 0;
  if (dataAsOf >= monday) {
    const inWeek = dataAsOf < friday ? dataAsOf : friday;
    const wd = dow(inWeek);
    fraction = wd === 0 || wd === 6 ? 1 : CUMULATIVE_WEEK_SHARES[wd - 1];
  }

  // Headline day = most recent working day with data (falls back to last week early in this week).
  const latestWorkingDay = latestWorkingDayOnOrBefore(dataAsOf);
  const latestWorkingDayIndex = dow(latestWorkingDay) - 1; // Mon(1)→0 … Fri(5)→4

  return {
    dataAsOf,
    windowStart: monday,
    windowEnd: shiftDays(monday, 6), // include the weekend so weekend activity counts toward the week
    weekDays,
    cumulativeShares: [...CUMULATIVE_WEEK_SHARES],
    fraction,
    latestWorkingDay,
    latestWorkingDayIndex,
    currentWeekPending: dataAsOf < monday,
    loadStart: latestWorkingDay < monday ? latestWorkingDay : monday,
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
