// The pacing seam — the ONE place that decides "how far through the chase are we?".
//
// The lake is day-grained and rebuilt nightly, so the honest v1 chase is MONTH-TO-DATE at day
// granularity: fraction = working days loaded ÷ working days in the month, and "now" is the latest
// complete day in the lake. If a true intraday feed (or the simulated "drip" mode) ever lands, it
// plugs in HERE — pages and datasets consume PacingContext and never know the cadence.

import { monthOf } from "./trends.js";
import { workingDaysElapsed, workingDaysInMonth } from "../../domain/targets.js";

export interface PacingContext {
  /** The latest complete day loaded in the lake (YYYY-MM-DD) — the chase measures through this day. */
  dataAsOf: string;
  /** First day of the chase month (YYYY-MM-DD). */
  monthStart: string;
  /** Last day of the chase month (YYYY-MM-DD). */
  monthEnd: string;
  /** Working days from the 1st through dataAsOf. */
  workingDaysElapsed: number;
  /** Working days in the whole month. */
  workingDaysTotal: number;
  /** Chase fraction 0..1 — how far through the month the loaded data reaches. */
  fraction: number;
  /** Label for the NOW marker on pace charts, e.g. "Jul 5". */
  nowLabel: string;
}

/** Month-to-date pacing anchored on the lake's latest complete day. */
export function mtdPacing(dataAsOf: string): PacingContext {
  const month = monthOf(dataAsOf);
  const elapsed = workingDaysElapsed(dataAsOf);
  const total = workingDaysInMonth(dataAsOf);
  const [, m, d] = dataAsOf.split("-").map(Number);
  const monthName = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1];
  return {
    dataAsOf,
    monthStart: month.from,
    monthEnd: month.to,
    workingDaysElapsed: elapsed,
    workingDaysTotal: total,
    fraction: total > 0 ? Math.min(1, elapsed / total) : 1,
    nowLabel: `${monthName} ${d}`,
  };
}
