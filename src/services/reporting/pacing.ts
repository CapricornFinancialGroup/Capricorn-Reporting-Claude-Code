// The pacing seam — the ONE place that decides "which week are we chasing, and how far through?".
//
//   • weeklyPacing (the run chase, per Conor's 2026-07-06 principles): Capricorn's own Sat–Fri
//     reporting week (`docs/data-dictionary.md`) containing today (business tz), chased against
//     the weekly target with WEIGHTED working days (Fri = 80% of a Mon–Thu day). The lake reloads
//     4× daily but the chase deliberately measures through COMPLETE days only (`completeThrough`),
//     so early in the week the current week may hold little data yet — that's expected. Today's
//     partial figure is surfaced SEPARATELY (see `todaySoFar` in datasets.ts), never folded in.
//     `fraction` (expected-by-now) is measured through the latest current-week day that HAS data,
//     so it stays comparable to the actual. The headline day counter uses `latestWorkingDay` — the
//     most recent working day with data anywhere (falls back to last week early-Monday) so the
//     board is never blank.
//   • mtdPacing (month-to-date) — used for month-window screens (funnel volumes).
//
// If a true intraday feed (or the simulated "drip" mode) ever lands, it plugs in HERE — pages and
// datasets consume PacingContext and never know the cadence.

import { blendedCumulativeForWeek, cumulativeSharesForWeek, KPI_KEYS, type KpiKey } from "../../domain/targets.js";
import { isBankHoliday } from "../../domain/calendar.js";
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

/** Index of `iso` within its own Sat–Fri week: 0=Sat, 1=Sun, 2=Mon … 6=Fri. */
export function weekDayIndex(iso: string): number {
  return (dow(iso) + 1) % 7;
}

/** How far through its Sat–Fri week `iso` is, by the same weighted day curve as the run chase.
 *  The one seam for "is this week still in progress, and by how much" — anywhere that compares a
 *  current, possibly-partial week against a complete one (Momentum's trend, the League's
 *  most-improved) should extrapolate through this, not re-derive its own day-of-week math (two
 *  copies of this drifting apart would just reopen the "the numbers don't agree across screens"
 *  complaint Conor already raised once, 2026-07-07).
 *
 *  Saturday is NO LONGER zero. It used to be, which meant a Saturday's trading — ~36 leads a day —
 *  counted towards the actual while contributing nothing to the expectation, so the board read
 *  "ahead" on Saturday and Sunday every week for the wrong reason. Pass `kpi` when it is known; the
 *  blended curve is only for genuinely mixed measures. */
export function weekElapsedFraction(iso: string, kpi?: KpiKey): number {
  const i = weekDayIndex(iso);
  // The curve is derived from THIS week's dates, not from day-of-week alone, so a bank holiday inside
  // the week moves the expectation off the closed day and onto the days that were open. See
  // `dayWeightsForWeek`.
  const days = weekDatesOf(iso);
  return kpi ? cumulativeSharesForWeek(kpi, days)[i] : blendedCumulativeForWeek(days)[i];
}

/** The seven dates of the Sat–Fri reporting week containing `iso`, Sat first. */
export function weekDatesOf(iso: string): string[] {
  const start = weekStartOf(iso);
  return Array.from({ length: 7 }, (_, i) => shiftDays(start, i));
}

/**
 * The latest day the lake can honestly claim to hold COMPLETE data for.
 *
 * `MAX(LeadDate)` is NOT that day. Leads are created live in the platform, so a handful dated today
 * land in an early load and drag the whole board's "data as of" a day forward while every other
 * fact still stops at yesterday. Observed 2026-07-30: MAX(LeadDate) = 30 Jul with **1 lead**, while
 * MAX(WrittenDate) and MAX(status-70) were both 29 Jul.
 *
 * That is not cosmetic. `weeklyPacing` derives `fraction` from this date, so the board compared
 * Wednesday's data against Thursday's expectation and reported the firm ~1 day of target further
 * behind than it was: leads 351 against an expected 527 ("BEHIND −176"), applications 40 against 96
 * ("−56"), both KPIs flagged CRITICAL with the headline day showing 1 lead and 0 applications at
 * 11:19. That is what Kyle saw on 2026-07-30.
 *
 * Today is not a COMPLETE day until its final load of the evening, so cap at yesterday for target
 * comparisons. NOTE the lake reloads 4× daily, so today IS partly available — see the note below on
 * showing it separately rather than folding it into the chase. Kept pure and
 * separate from the query so the rule is unit-testable.
 */
export function completeThrough(maxLeadDate: string, today: string): string {
  const yesterday = shiftDays(today, -1);
  return maxLeadDate < yesterday ? maxLeadDate : yesterday;
}

/**
 * The freshest business day the board actually HOLDS — which is today, once today has any business on
 * it, and the last complete day otherwise.
 *
 * Different question from `completeThrough`, and the board needs both. `completeThrough` answers
 * "how far can I compare against target?" and deliberately stops at yesterday. This answers "what is
 * the newest day on this screen?" — and since 2026-08-21 the screens carry today: the dotted segment
 * on each chase chart, the "today so far" figure, and the ticker's own date.
 *
 * Stamping the header with the complete-day boundary instead made the board read a day stale. Kyle
 * queried it as a broken refresh three times (2026-08-10, 08-21, 08-24) and Capricorn again on 08-24:
 * "it is confusing saying yesterday's date — if we have refreshed on the day, make the date reflect
 * that date." The boundary has not moved; only which of the two questions the header answers.
 *
 * `todayCount` is the count actually loaded for today, and gating on it is the point: an 06:00 load
 * lands before anyone has written anything, so claiming the board reaches today at that hour would be
 * a date with nothing behind it. Deliberately the SAME rule the ticker uses to choose its date
 * (`liveFeed`), so the two stamps cannot contradict each other — which is what the header did while
 * the ticker beside it already read today.
 */
export function dataThroughDay(asOf: string, today: string, todayCount: number): string {
  if (!isTradingDay(today) || todayCount <= 0) return asOf;
  return today > asOf ? today : asOf;
}

/** Gates the "today so far" figure: a wall board reading "Today so far: 0" on a non-trading day
 *  is noise, not information — nobody is writing business, so there is nothing to be behind on.
 *
 *  Saturday IS a trading day at Capricorn (Kyle, 2026-08-04) — ~36 leads a day, and the reporting
 *  week is Sat–Fri precisely to capture it. Only Sunday is excluded, which runs 0–10 leads. */
export function isTradingDay(iso: string): boolean {
  // A bank holiday is not a trading day either. Added 2026-09-01 after Monday 31 August, the summer
  // bank holiday, was judged as a full trading Monday: 5 leads against a 122 target, and a week-to-date
  // reading 136 leads behind for three days nobody worked. See `src/domain/calendar.ts`.
  return dow(iso) !== 0 && !isBankHoliday(iso); // 0 = Sunday
}

/** The latest trading day at or before `iso`. Only ever walks back one day, since Sunday is the sole
 *  non-trading day — written as a loop rather than a special case so it still holds if Capricorn ever
 *  rules another day out. */
export function lastTradingDayOnOrBefore(iso: string): string {
  let d = iso;
  for (let i = 0; i < 7 && !isTradingDay(d); i++) d = shiftDays(d, -1);
  return d;
}

/**
 * Is the reporting week containing `asOf` still nothing but weekend?
 *
 * The week runs Sat–Fri and `asOf` is the last COMPLETE day, so from Saturday morning until
 * Tuesday's load the current week holds only Sat (+Sun) — roughly 6% of a week's business and not
 * one weekday. Market Momentum leads with the current week (Kyle asked for that on 2026-08-07), and
 * for three days in every seven that headline was a weekend: W33 showed 1 mortgage written and
 * −92.9% against W32's same two days. Kyle read the whole board as broken — "I don't think this is
 * refreshing 5 times a day as the below figures are completely off" (2026-08-10). Every number was
 * right; leading with them was not.
 *
 * True ⇒ the last COMPLETE week keeps the headline and the current week is shown underneath at its
 * real size. False from the Monday-complete load onward, which is when the comparison starts to
 * carry a trading day and means something.
 */
export function isWeekendOnlyWeek(asOf: string): boolean {
  return weekDayIndex(asOf) < 2; // 0 = Sat, 1 = Sun, 2 = Mon
}

function shortLabel(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  const monthName = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1];
  return `${monthName} ${d}`;
}

export interface WeeklyPacingContext extends PacingContext {
  /** All SEVEN days of the current chase week, Sat..Fri (YYYY-MM-DD). Was Mon..Fri until
   *  2026-08-04, which is why a Saturday's trading had nowhere to appear (Kyle: "we do Saturday
   *  coverage which can result in circa 50+ leads"). */
  weekDays: string[];
  /** Cumulative expected share by end of each of the seven days, per KPI (0..1). */
  cumulativeShares: Record<KpiKey, number[]>;
  /** Blended cumulative curve — for charts and screens that pace a mixed measure. */
  blendedShares: number[];
  /** The headline day counter's day: the most recent day WITH data (≤ dataAsOf). Early in a week
   *  this may be last week's Friday, so the board is never blank. */
  latestDay: string;
  /** Index (0=Sat … 6=Fri) of latestDay within ITS week — picks that day's target share. */
  latestDayIndex: number;
  /** True when the current week has no loaded data yet — the day counter is then showing a day from
   *  last week. Now measured against the week's FIRST day (Saturday), not Monday: with Saturday a
   *  real trading day, a Sunday dataAsOf is no longer "the week hasn't started". */
  currentWeekPending: boolean;
  /** Earliest day the dataset layer must load to cover both the current week and the day counter. */
  loadStart: string;
  /** Expected-by-now fraction of the weekly target, per KPI. */
  fractionByKpi: Record<KpiKey, number>;
}

/** Weighted CURRENT-week chase, Capricorn's Sat–Fri reporting week (`docs/data-dictionary.md`).
 *  `today` = current business date (drives which week); `dataAsOf` = latest complete lake day
 *  (drives how much data we actually have). */
export function weeklyPacing(today: string, dataAsOf: string): WeeklyPacingContext {
  const windowStart = weekStartOf(today); // Saturday
  const weekDays = Array.from({ length: 7 }, (_, i) => shiftDays(windowStart, i)); // Sat..Fri
  const friday = weekDays[6];

  // Expected-by-now: measured through the latest CURRENT-WEEK day that has data (≤ dataAsOf), capped
  // at Friday. Before the week has started at all (dataAsOf < Saturday) → 0.
  const inWeek = dataAsOf < friday ? dataAsOf : friday;
  const fractionFor = (kpi: KpiKey): number =>
    dataAsOf < windowStart ? 0 : weekElapsedFraction(inWeek, kpi);
  const fractionByKpi = Object.fromEntries(KPI_KEYS.map((k) => [k, fractionFor(k)])) as Record<KpiKey, number>;

  // Headline day = the most recent TRADING day with data. Saturday gets its own tile (it is a real
  // trading day, ~38 cases); Sunday does not, and this is where that was missed.
  //
  // It was plain `dataAsOf`, and `dataAsOf` is capped at yesterday — so every MONDAY the judged day
  // was Sunday. Sunday runs ~5 cases against a leads target of 9, so the board opened every week
  // reporting "0 vs 9 · CRITICAL" for not working on a Sunday. On 2026-08-24 it was worse than that:
  // at the 05:53 load MAX(LeadDate) was still Saturday, so the tile correctly read Sat 22 — 44 vs 38,
  // +6 AHEAD. The 11:15 load brought Monday's first fifteen cases, which pushed MAX(LeadDate) to
  // Monday, which pushed the yesterday-cap onto Sunday, and the tile flipped to 0 vs 9 CRITICAL. More
  // data arriving made the board worse, which is the opposite of what a refresh is for, and it is what
  // Kyle was looking at when he asked whether the refresh was broken.
  //
  // `isTradingDay` already existed and already said Sunday is not one — "a wall board reading 'Today
  // so far: 0' on a non-trading day is noise, not information — nobody is writing business, so there
  // is nothing to be behind on". That rule gated the today figure and was never applied here. Same
  // reasoning, same rule, now applied to both.
  //
  // Only the JUDGED DAY moves. `fraction` and the week-to-date still measure through `dataAsOf`, so
  // Sunday's business (whatever there is of it) still counts towards the week — it just stops being
  // handed a day target it was never going to meet.
  const latestDay = lastTradingDayOnOrBefore(dataAsOf);
  const latestDayIndex = weekDayIndex(latestDay);

  return {
    dataAsOf,
    windowStart,
    windowEnd: friday,
    weekDays,
    // Curves for THIS week's actual dates — a bank holiday inside it carries no expectation and its
    // share moves to the days that are open. Everything downstream (the chase charts' target line, the
    // office pace line, the per-day tiles) reads these, so they all agree on which days counted.
    cumulativeShares: Object.fromEntries(
      KPI_KEYS.map((k) => [k, cumulativeSharesForWeek(k, weekDays)]),
    ) as Record<KpiKey, number[]>,
    blendedShares: blendedCumulativeForWeek(weekDays),
    fraction: dataAsOf < windowStart ? 0 : weekElapsedFraction(inWeek),
    fractionByKpi,
    latestDay,
    latestDayIndex,
    currentWeekPending: dataAsOf < windowStart,
    // Load-bearing: reaching back to windowStart (Saturday) is what makes weekend rows actually
    // get fetched once the week is under way, not just the fallback day early on.
    loadStart: latestDay < windowStart ? latestDay : windowStart,
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
