// The pacing seam — the ONE place that decides "how far through the chase are we?".
//
// The lake is day-grained and rebuilt nightly, so pacing anchors on the latest complete day loaded
// ("data as of"). Two models live here:
//
//   • weeklyPacing (the run chase, per Conor's 2026-07-06 principles): Mon–Fri chase against the
//     weekly target with WEIGHTED days (Fri = 80% of a Mon–Thu day), fraction = cumulative
//     expected share by end of the data-as-of day. The week rolls automatically when the lake
//     loads the first Monday of a new week — the "refresh every Monday 09:00" behaviour, one day
//     lagged by the nightly load.
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

function shortLabel(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  const monthName = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1];
  return `${monthName} ${d}`;
}

export interface WeeklyPacingContext extends PacingContext {
  /** The five working days of the chase week (Mon..Fri, YYYY-MM-DD). */
  weekDays: string[];
  /** Cumulative expected share of the weekly target by end of each working day (0..1). */
  cumulativeShares: number[];
  /** Latest complete WORKING day (Mon–Fri) ≤ dataAsOf — the day the headline counter references
   *  (weekends fold back to Friday so a Sunday's near-zero doesn't read as "behind"). */
  latestWorkingDay: string;
  /** 0..4 (Mon..Fri) index of latestWorkingDay — picks its DAY_WEIGHTS share. */
  latestWorkingDayIndex: number;
}

/** Weighted weekly chase anchored on the lake's latest complete day. Weekend data-as-of days
 *  (Sat/Sun) read as the just-finished week at fraction 1. */
export function weeklyPacing(dataAsOf: string): WeeklyPacingContext {
  const monday = mondayOf(dataAsOf);
  const weekDays = Array.from({ length: 5 }, (_, i) =>
    new Date(new Date(`${monday}T00:00:00Z`).getTime() + i * DAY_MS).toISOString().slice(0, 10),
  );
  const d = dow(dataAsOf);
  // Mon..Fri → cumulative share through that day; Sat/Sun → the week is complete.
  const fraction = d === 0 || d === 6 ? 1 : CUMULATIVE_WEEK_SHARES[d - 1];
  // Latest working day ≤ dataAsOf: Fri if the anchor is a weekend, else the anchor itself.
  const latestWorkingDayIndex = d === 0 || d === 6 ? 4 : d - 1; // Sun/Sat → Fri(4)
  return {
    dataAsOf,
    windowStart: monday,
    windowEnd: shiftDays(monday, 6), // include the weekend so weekend activity counts toward the week
    weekDays,
    cumulativeShares: [...CUMULATIVE_WEEK_SHARES],
    fraction,
    latestWorkingDay: weekDays[latestWorkingDayIndex],
    latestWorkingDayIndex,
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
