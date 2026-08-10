// Dataset facade — the single source both route prefixes (/api/reporting/* behind Easy Auth,
// /api/kiosk token-gated) resolve through. One composite payload per screen; a short server-side
// TTL cache means N wall TVs cost ~one Fabric query set per dataset per TTL.
//
// Chase model (Conor's weekly principles, 2026-07-06): the run chase is WEEK-TO-DATE vs weekly
// targets with weighted days (Mon–Thu 20.83% each, Fri 16.67%), measured through the latest
// complete day loaded ("data as of" — the lake reloads 5× daily). The week is Capricorn's own Sat–Fri reporting
// week (`docs/data-dictionary.md`), rolling each Saturday. Funnel volumes remain month-to-date.
// The pacing seam (pacing.ts) is the single plug-point for a future intraday or drip feed and for
// the live Team-Targets source when Capricorn provides one.

import type { Config } from "../../config.js";
import {
  INPUT_LAG_SETTLE_DAYS,
  MORTGAGE_WRITTEN_DATE,
  PROTECTION_WRITTEN_DATE,
  PROTECTION_WRITTEN_STATUSES,
} from "../../domain/data-quality.js";
import { ORGANISATIONS } from "../../domain/firm.js";
import { DATA_CADENCE, METRIC_DEFINITIONS } from "../../domain/metrics.js";
import { OFFICES, UNASSIGNED, officeOf, officeOrderIndex } from "../../domain/offices.js";
import { needsExplaining, settleThrough } from "../snapshots/history.js";
import { closedWeekStarts, loadRevisions, observeWeeks } from "../snapshots/recorder.js";
import {
  dayTarget,
  KPI_KEYS,
  KPI_LABELS,
  LEAGUE,
  REFERRAL_RATE_TARGET,
  WEEK_DAY_NAMES,
  type KpiKey,
  type KpiTargets,
} from "../../domain/targets.js";
import { cached } from "./cache.js";
import { EMPTY_FILTERS, type ReportFilters } from "./filters.js";
import * as funnelQ from "./funnel.js";
import { kpiDaily, kpiDailyByAdviser, type AdviserDailyCount, type DailyCount } from "./kpis.js";
import * as momentumQ from "./momentum.js";
import { chaseStatus, computePace, tzToday, type ChaseStatus, type Pace } from "./pace.js";
import { completeThrough, isTradingDay, mtdPacing, weekDayIndex, weekElapsedFraction, weeklyPacing, type WeeklyPacingContext } from "./pacing.js";
import { run, type BuiltQuery } from "./query.js";
import { revenueByAdviser, type AdviserRevenue } from "./advisers.js";
import { getDailyTargets, getOfficeDailyTargets, getTargetsProvenance, getWrittenWeeklyTargets } from "../targets/store.js";
import * as tickerQ from "./ticker.js";
import { isoWeekNo, pctDelta, previousPeriod, shiftDays, weekdaysBetween, weekStartOf } from "./trends.js";
import { divide, round } from "./util.js";

// ---------------------------------------------------------------------------
// Plumbing
// ---------------------------------------------------------------------------

function lakePool(config: Config) {
  return { server: config.fabric.endpoint, database: config.fabric.database };
}

function q<T>(config: Config, query: BuiltQuery): Promise<T[]> {
  return run<T>(lakePool(config), query);
}

function ttl(config: Config): number {
  return Math.max(0, config.reporting.cacheTtlSeconds) * 1000;
}

/** ISO date of a Date-ish value the driver returns (Date object or string). */
function isoDay(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

// ---------------------------------------------------------------------------
// Shared chase core (cached): pacing context + the 4 KPIs at both grains
// ---------------------------------------------------------------------------

/** Latest COMPLETE day in the lake.
 *
 *  MAX(LeadDate) alone is wrong: leads are created live, so a few dated today ride into an early
 *  build and pull "data as of" a day ahead of every other fact — which then makes the whole run chase
 *  pace against a day it has no data for. `completeThrough` caps it at yesterday. See its docstring
 *  for the 2026-07-30 case that exposed this. */
async function dataAsOf(config: Config): Promise<string> {
  return cached("data-as-of", 5 * 60_000, async () => {
    const rows = await q<{ maxDay: unknown }>(config, {
      text: `SELECT MAX(LeadDate) AS maxDay FROM dbo.mortgagecase WHERE COALESCE(DeletedYN, 'N') <> 'Y';`,
      params: [],
    });
    const v = rows[0]?.maxDay;
    if (!v) throw new Error("Lake returned no MAX(LeadDate) — is GAGold_Capricorn loaded?");
    return completeThrough(isoDay(v), tzToday(new Date(), config.reporting.timeZone));
  });
}

/** When the lake was actually last loaded — MAX(_etl_modified), the ETL's own watermark.
 *
 *  The share is NOT a nightly build, despite what the README claimed until 2026-08-04. It loads FIVE
 *  times a day, ~07:50 / 11:10 / 14:15 / 17:10 / 20:10 UTC (verified: 5 distinct load stamps on each
 *  of 1, 2 and 3 Aug 2026). So business written at 3pm reaches the board at the 17:10 load, roughly two
 *  hours later — not the next morning. Surfaced so the header can state the truth instead of a cadence
 *  nobody had checked. */
export async function lastRefreshAt(config: Config): Promise<string | null> {
  return cached("last-refresh-at", 60_000, async () => {
    const rows = await q<{ at: unknown }>(config, {
      text: `SELECT MAX(_etl_modified) AS at FROM dbo.mortgagecase;`,
      params: [],
    });
    const v = rows[0]?.at;
    return v instanceof Date ? v.toISOString() : v ? String(v) : null;
  });
}

/** Today's PARTIAL counts, and when they were loaded. */
export interface TodaySoFar {
  /** Business date these counts cover (YYYY-MM-DD) — always today, never the chase's dataAsOf. */
  date: string;
  /** The load that produced them, so the number carries its own age. */
  loadedAt: string | null;
  counts: Record<KpiKey, number>;
}

/**
 * "Today so far" — deliberately OUTSIDE the chase maths.
 *
 * Kyle's and Conor's question is a 3pm one: what has happened today? The lake reloads 5× daily, so we
 * can answer it — but the chase itself must keep measuring through COMPLETE days. Folding today's
 * part-day into `wtd` is exactly the 2026-07-30 failure in reverse: the actual would carry ~4 hours of
 * a day whose target counts a full one, so every KPI would drift "behind" as the morning wore on and
 * quietly recover by evening. So this is a SEPARATE query over [today, today] and a separate figure on
 * the card; `chaseCore` and every wtd/pace/projection number it feeds are untouched by it.
 *
 * Null on Sundays — see `isTradingDay`.
 */
async function todaySoFar(config: Config): Promise<TodaySoFar | null> {
  return cached("today-so-far", 60_000, async () => {
    const today = tzToday(new Date(), config.reporting.timeZone);
    if (!isTradingDay(today)) return null;
    const [rows, loadedAt] = await Promise.all([
      loadPerKpi<DailyCount>(config, (k) => kpiDaily(k, today, today)),
      lastRefreshAt(config),
    ]);
    const counts = Object.fromEntries(KPI_KEYS.map((k) => [k, sum(rows[k].map((r) => r.n))])) as Record<KpiKey, number>;
    return { date: today, loadedAt, counts };
  });
}

interface ChaseCore {
  ctx: WeeklyPacingContext;
  /** Business-wide daily counts per KPI across the chase week (Mon→dataAsOf). */
  daily: Record<KpiKey, DailyCount[]>;
  /** Daily counts per adviser per KPI across the chase week. */
  byAdviser: Record<KpiKey, AdviserDailyCount[]>;
}

async function chaseCore(config: Config): Promise<ChaseCore> {
  return cached("chase-core", ttl(config), async () => {
    const asOf = await dataAsOf(config);
    const today = tzToday(new Date(), config.reporting.timeZone);
    const ctx = weeklyPacing(today, asOf);
    // Load from loadStart (covers both the current week and the day counter's fallback day) up to
    // the latest lake day. The `to` is clamped ≥ loadStart so an all-future current week (early
    // Monday) still returns the fallback day's rows rather than an inverted empty range.
    const to = asOf >= ctx.loadStart ? asOf : ctx.loadStart;
    const [daily, byAdviser] = await Promise.all([
      loadPerKpi(config, (k) => kpiDaily(k, ctx.loadStart, to)),
      loadPerKpi(config, (k) => kpiDailyByAdviser(k, ctx.loadStart, to)),
    ]);
    return { ctx, daily: daily as Record<KpiKey, DailyCount[]>, byAdviser: byAdviser as Record<KpiKey, AdviserDailyCount[]> };
  });
}

async function loadPerKpi<T>(config: Config, build: (k: KpiKey) => BuiltQuery): Promise<Record<KpiKey, T[]>> {
  const rows = await Promise.all(KPI_KEYS.map((k) => q<T>(config, build(k))));
  return Object.fromEntries(KPI_KEYS.map((k, i) => [k, rows[i]])) as Record<KpiKey, T[]>;
}

const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

/** Keep only rows dated within the current chase week (drops the day-counter fallback day, which
 *  may sit in the prior week). */
function weekRows<T extends { d: string }>(rows: T[], ctx: WeeklyPacingContext): T[] {
  return rows.filter((r) => {
    const d = isoDay(r.d);
    return d >= ctx.windowStart && d <= ctx.windowEnd;
  });
}

/** Cumulative counts aligned to the week's working days. The chase window now LEADS with the
 *  weekend (Sat–Fri), so any weekend rows sort chronologically before Monday and fold into it
 *  automatically as the cursor advances through `allDates` — no trailing-fold special case
 *  needed. The line is null after the data-as-of day (it stops at the present). */
export function cumulativeSeries(daily: DailyCount[], days: string[], asOf: string): Array<number | null> {
  const byDay = new Map<string, number>();
  for (const r of daily) {
    const d = isoDay(r.d);
    byDay.set(d, (byDay.get(d) ?? 0) + r.n);
  }
  const allDates = [...byDay.keys()].sort();
  let cum = 0;
  let di = 0;
  return days.map((day) => {
    if (day > asOf) return null;
    while (di < allDates.length && allDates[di] <= day) {
      cum += byDay.get(allDates[di]) ?? 0;
      di++;
    }
    return cum;
  });
}

/** Weighted target pace across the week: cumulative expected count by end of each working day
 *  (Fri carries 80% of a Mon–Thu day — the kink is intentional). */
function weeklyTargetPace(weekly: number, cumulativeShares: number[]): number[] {
  return cumulativeShares.map((s) => Math.round(weekly * s));
}

/** Dashed projection: null until "now", then a straight line from the current value to the
 *  projected finish on the last working day. */
function projectionSeries(actual: Array<number | null>, projectedFinish: number): Array<number | null> {
  let nowIdx = -1;
  for (let i = 0; i < actual.length; i++) if (actual[i] != null) nowIdx = i;
  if (nowIdx < 0 || nowIdx >= actual.length - 1) return actual.map(() => null);
  const start = actual[nowIdx] ?? 0;
  const steps = actual.length - 1 - nowIdx;
  return actual.map((_, i) => {
    if (i < nowIdx) return null;
    if (i === nowIdx) return start;
    return Math.round(start + ((projectedFinish - start) * (i - nowIdx)) / steps);
  });
}

const dayTotal = (rows: DailyCount[], day: string): number =>
  sum(rows.filter((r) => isoDay(r.d) === day).map((r) => r.n));

/** Weekly bucket starts (Sat-anchored, weekStartOf) ending at `asOf`'s week — shared by Market
 *  Momentum and the Funnel Health gap chart so both use the identical windowing rule: an explicit
 *  `from` (dashboard filter) spans whole weeks to asOf's week; else a rolling window. */
function weekStartsFor(asOf: string, from: string | null | undefined, rollingWeeks: number): string[] {
  const endWeek = weekStartOf(asOf);
  const weekStarts: string[] = [];
  if (from) {
    for (let w = weekStartOf(from); w <= endWeek; w = shiftDays(w, 7)) weekStarts.push(w);
  } else {
    for (let i = rollingWeeks - 1; i >= 0; i--) weekStarts.push(shiftDays(endWeek, -7 * i));
  }
  return weekStarts;
}

// ---------------------------------------------------------------------------
// Office aggregation (adviser → office in TS; mapping is config)
// ---------------------------------------------------------------------------

interface OfficeCums {
  office: string;
  color: string;
  /** MTD totals per KPI. */
  mtd: KpiTargets;
  /** Latest-day totals per KPI. */
  latest: KpiTargets;
  /** Cumulative-by-working-day per KPI (aligned to the chase week). */
  series: Record<KpiKey, Array<number | null>>;
  /** Advisers contributing to this office this week, busiest first — populated for UNASSIGNED only.
   *  "What are the 19 unassigned?" is a question the board should answer on its own face rather than
   *  by email (Kyle, 2026-08-06). Unassigned means we have no office on file for that adviser, so
   *  naming them turns a mystery number into a one-line fix Capricorn can hand back. */
  members?: Array<{ name: string; leads: number }>;
}

function emptyKpiRecord(): KpiTargets {
  return { leads: 0, applications: 0, referrals: 0, sales: 0 };
}

function officeAggregates(core: ChaseCore): OfficeCums[] {
  const days = core.ctx.weekDays;
  const officeList = [...OFFICES.map((o) => ({ name: o.name, color: o.color })), { name: UNASSIGNED, color: "#64748B" }];
  return officeList.map(({ name, color }) => {
    const mtd = emptyKpiRecord();
    const latest = emptyKpiRecord();
    const series = {} as Record<KpiKey, Array<number | null>>;
    for (const k of KPI_KEYS) {
      const mine = core.byAdviser[k].filter((r) => officeOf(r.username) === name);
      const dailyMine: DailyCount[] = weekRows(mine.map((r) => ({ d: r.d, n: r.n })), core.ctx);
      mtd[k] = sum(dailyMine.map((r) => r.n)); // week-to-date for this office
      latest[k] = sum(mine.filter((r) => isoDay(r.d) === core.ctx.latestDay).map((r) => r.n));
      series[k] = cumulativeSeries(dailyMine, days, core.ctx.dataAsOf);
    }
    let members: Array<{ name: string; leads: number }> | undefined;
    if (name === UNASSIGNED) {
      // Across ALL KPIs: an unmapped adviser who wrote business this week but sourced no leads still
      // has to be named, or the card reads "8 applications" above an empty list.
      const byAdviser = new Map<string, number>();
      for (const k of KPI_KEYS) {
        for (const r of weekRows(core.byAdviser[k], core.ctx)) {
          if (officeOf(r.username) !== UNASSIGNED) continue;
          const who = r.fullName?.trim() || r.username?.trim() || "(no adviser on case)";
          byAdviser.set(who, (byAdviser.get(who) ?? 0) + r.n);
        }
      }
      members = [...byAdviser.entries()]
        .map(([n, leads]) => ({ name: n, leads }))
        .sort((a, b) => b.leads - a.leads);
    }
    return { office: name, color, mtd, latest, series, members };
  });
}

/** % of expected-by-now weekly pace, averaged across the four KPIs. Null when no targets. */
function pctToPace(wtd: KpiTargets, dailyTargets: KpiTargets, ctx: WeeklyPacingContext): number | null {
  const ratios: number[] = [];
  for (const k of KPI_KEYS) {
    const weekly = dailyTargets[k] * 5;
    const expected = weekly * ctx.fractionByKpi[k];
    if (expected > 0) ratios.push(wtd[k] / expected);
  }
  if (!ratios.length) return null;
  return Math.round((sum(ratios) / ratios.length) * 100);
}

function officeStatus(pct: number | null): ChaseStatus {
  if (pct == null) return "on_pace";
  return chaseStatus(pct, 100);
}

// ---------------------------------------------------------------------------
// meta
// ---------------------------------------------------------------------------

/** Closed weeks whose figures have moved in a way input lag doesn't explain.
 *
 *  Carried on `meta` so the flag reaches EVERY screen, not just Reconciliation. The whole failure
 *  this addresses is that a figure changed underneath a number someone had already acted on — a
 *  warning that only appears on the audit screen would be seen by whoever was already suspicious,
 *  which is the one person who doesn't need it. Cached long: the scheduler only re-observes every
 *  30 minutes, so this cannot change faster than that. */
async function revisedWeekCount(config: Config): Promise<number> {
  if (!config.snapshots.storageAccount) return 0;
  return cached("revised-week-count", 5 * 60_000, async () => {
    try {
      const today = tzToday(new Date(), config.reporting.timeZone);
      const revisions = await loadRevisions(config, closedWeekStarts(today));
      return revisions.filter((r) => needsExplaining(r)).length;
    } catch {
      // Never let a storage hiccup take the header — and so the board — down.
      return 0;
    }
  });
}

export async function meta(config: Config) {
  const [asOf, refreshedAt, revisedWeeks] = await Promise.all([
    dataAsOf(config),
    lastRefreshAt(config),
    revisedWeekCount(config),
  ]);
  const daily = getDailyTargets();
  const weekly = Object.fromEntries(KPI_KEYS.map((k) => [k, daily[k] * 5])) as KpiTargets;
  return {
    offices: [...OFFICES],
    targets: {
      daily,
      weekly,
      officeDaily: getOfficeDailyTargets(),
      // WEEKLY written targets, £ — Mortgage + Insurance (the dashboard's "Revenue"). Kyle 2026-07-14.
      writtenWeekly: getWrittenWeeklyTargets(),
    },
    targetsProvenance: getTargetsProvenance(),
    dataAsOf: asOf,
    /** Wall-clock of the lake's last load (ISO, UTC) — the honest freshness stamp. */
    lastRefreshAt: refreshedAt,
    /** Human cadence for the header. Not "overnight": see lastRefreshAt's docstring. */
    refreshCadence: DATA_CADENCE.refresh,
    /** Closed weeks that have moved unexpectedly — drives the header warning on every screen. */
    revisedWeeks,
    refreshSeconds: config.reporting.refreshSeconds,
    cycleSeconds: config.reporting.cycleSeconds,
    pacingMode: config.reporting.pacingMode,
    timeZone: config.reporting.timeZone,
  };
}

// ---------------------------------------------------------------------------
// Screen 1 — Daily Run Chase
// ---------------------------------------------------------------------------

export async function dailyRunChase(config: Config, _f: ReportFilters) {
  return cached("ds-daily-run-chase", ttl(config), async () => {
    const core = await chaseCore(config);
    const { ctx } = core;
    const days = ctx.weekDays;

    // Total LENDING (Conor 2026-07-07, item 5): total mortgage/loan value written this chase week —
    // the same WrittenDate column the Mortgages Written KPI uses, so date semantics line up. NOT
    // commission (that's Momentum's "Weekly Written" and the League's "Est. Revenue").
    const [writtenRows, today] = await Promise.all([
      q<momentumQ.RevenueDaily>(config, momentumQ.revenueDaily(ctx.windowStart, ctx.dataAsOf)),
      todaySoFar(config),
    ]);
    const totalWritten = Math.round(sum(writtenRows.map((r) => r.totalValue ?? 0)));

    const dailyTargets = getDailyTargets();
    const kpis = KPI_KEYS.map((k) => {
      const weekly = dailyTargets[k] * 5;
      const thisWeek = weekRows(core.daily[k], ctx);
      const wtd = sum(thisWeek.map((r) => r.n));
      // Each KPI paces against ITS OWN day curve: Saturday is 6% of a week's leads but 1.5% of its
      // written business, so a shared curve would misstate one of them (see DAY_WEIGHTS).
      const fraction = ctx.fractionByKpi[k];
      const pace: Pace = computePace(weekly, wtd, fraction);
      const actual = cumulativeSeries(thisWeek, days, ctx.dataAsOf);
      // WTD context (for the trend chart + a secondary line): cumulative weekly position in %.
      const actualPct = weekly > 0 ? round((wtd / weekly) * 100, 1) : null;
      const expectedPct = round(fraction * 100, 1);
      // DAY view (the headline counter, per Conor's 2026-07-06 feedback): the latest day's actual vs
      // that day's target, with a day ahead/behind. Saturday now gets its own tile.
      const dayActual = dayTotal(core.daily[k], ctx.latestDay);
      const target = dayTarget(k, weekly, ctx.latestDayIndex);
      return {
        key: k,
        label: KPI_LABELS[k],
        weeklyTarget: weekly,
        wtd,
        // Week pace — drives the trend chart's header status (the chart is the WTD trend).
        pace,
        day: {
          date: ctx.latestDay,
          actual: dayActual,
          target,
          gap: dayActual - target,
          status: chaseStatus(dayActual, target),
        },
        weekProgress: {
          actualPct,
          expectedPct,
          // +ahead / −behind, percentage points of the weekly target.
          gapPp: actualPct != null && expectedPct != null ? round(actualPct - expectedPct, 1) : null,
        },
        chart: {
          days,
          actual,
          targetPace: weeklyTargetPace(weekly, ctx.cumulativeShares[k]),
          projection: projectionSeries(actual, pace.projectedFinish),
        },
      };
    });

    const officeDailyTargets = getOfficeDailyTargets();
    const leaderboard = officeAggregates(core)
      .map((o) => {
        const targets = officeDailyTargets[o.office] ?? emptyKpiRecord();
        const pct = pctToPace(o.mtd, targets, ctx);
        return {
          office: o.office,
          color: o.color,
          ...o.mtd,
          latest: o.latest,
          pct,
          status: officeStatus(pct),
          hasTargets: KPI_KEYS.some((k) => targets[k] > 0),
        };
      })
      .filter((o) => o.office !== UNASSIGNED || KPI_KEYS.some((k) => (o as Record<string, unknown>)[k] as number > 0))
      .sort((a, b) => b.leads - a.leads);

    return {
      dataAsOf: ctx.dataAsOf,
      totalWritten,
      // Intraday context, NOT part of the chase — see `todaySoFar`. Null on Sundays.
      today,
      week: {
        start: ctx.windowStart,
        end: ctx.windowEnd,
        days,
        dayNames: [...WEEK_DAY_NAMES],
        // Blended cumulative expected share by end of each of the seven days, %. The strip is a
        // single row across all KPIs, so it shows the blend; each KPI's own curve drives its card.
        cumulativeSharesPct: ctx.blendedShares.map((s) => round(s * 100, 2)),
        fraction: round(ctx.fraction, 4),
        expectedPct: round(ctx.fraction * 100, 1),
        nowLabel: ctx.nowLabel,
        latestDay: ctx.latestDay,
        pending: ctx.currentWeekPending,
      },
      dataAsOfLagsWeek: ctx.currentWeekPending,
      kpis,
      leaderboard,
    };
  });
}

// ---------------------------------------------------------------------------
// Screen 2 — Office Run Chase
// ---------------------------------------------------------------------------

export async function officeRunChase(config: Config, _f: ReportFilters) {
  return cached("ds-office-run-chase", ttl(config), async () => {
    const core = await chaseCore(config);
    const { ctx } = core;
    const days = ctx.weekDays;
    // The pace line spans all seven days now (Sat..Fri). Blended, because this chart carries every
    // KPI for an office on one axis; the per-KPI curves drive the per-KPI numbers below.
    const paceLine = ctx.blendedShares.map((s) => Math.round(s * 100));

    const officeDailyTargets = getOfficeDailyTargets();
    const offices = officeAggregates(core)
      .map((o) => {
        const targets = officeDailyTargets[o.office] ?? emptyKpiRecord();
        const hasTargets = KPI_KEYS.some((k) => targets[k] > 0);
        const kpis = KPI_KEYS.map((k) => {
          const weekly = targets[k] * 5;
          const pace = computePace(weekly, o.mtd[k], ctx.fractionByKpi[k]);
          return {
            key: k,
            label: KPI_LABELS[k],
            actual: o.mtd[k],
            target: weekly,
            expected: pace.expectedByNow,
            gap: pace.aheadBehind,
            status: chaseStatus(o.mtd[k], pace.expectedByNow),
          };
        });
        // Mini chart: blended % of weekly target achieved by day vs the weighted pace line.
        const pctSeries = days.map((_, i) => {
          const ratios: number[] = [];
          for (const k of KPI_KEYS) {
            const weekly = targets[k] * 5;
            const v = o.series[k][i];
            if (weekly > 0 && v != null) ratios.push(v / weekly);
          }
          return ratios.length ? Math.round((sum(ratios) / ratios.length) * 100) : null;
        });
        const pct = pctToPace(o.mtd, targets, ctx);
        const active = KPI_KEYS.some((k) => o.mtd[k] > 0);
        return {
          office: o.office,
          color: o.color,
          hasTargets,
          active,
          kpis,
          pct,
          status: officeStatus(pct),
          chart: { days, actualPct: pctSeries, targetPct: paceLine },
          // Unassigned only: who is in it. Turns "what are the 19 unassigned?" into a list Capricorn
          // can act on, instead of an email (Kyle 2026-08-06).
          members: o.members,
        };
      })
      .filter((o) => o.hasTargets || o.active);

    const ranked = offices
      .filter((o) => o.pct != null)
      .sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0))
      .map((o, i) => ({ ...o, rank: i + 1 }));
    const unranked = offices.filter((o) => o.pct == null).map((o) => ({ ...o, rank: null as number | null }));
    const champion = ranked[0]?.office ?? null;

    // Card/strip POSITION is Conor's fixed roster order (2026-07-07: "Office Order"), not
    // performance -- a wall display shouldn't reshuffle its layout every refresh. `rank` (above)
    // still carries the true performance ranking for the numbered badge and the LEADING card.
    const displayOrder = [...ranked, ...unranked].sort(
      (a, b) => officeOrderIndex(a.office) - officeOrderIndex(b.office),
    );

    return {
      dataAsOf: ctx.dataAsOf,
      week: {
        nowLabel: ctx.nowLabel,
        start: ctx.windowStart,
        end: ctx.windowEnd,
        expectedPct: Math.round(ctx.fraction * 100),
        pending: ctx.currentWeekPending,
      },
      offices: displayOrder,
      champion,
    };
  });
}

// ---------------------------------------------------------------------------
// Screen 3 — Adviser League
// ---------------------------------------------------------------------------

export async function adviserLeague(config: Config, f: ReportFilters) {
  const asOf = await dataAsOf(config);
  const today = tzToday(new Date(), config.reporting.timeZone);
  // Window: an explicit range (dashboard date filter) wins; default = the CURRENT week — the same
  // week as the Daily/Office Run Chase, so the league's headline totals agree with them instead of
  // quietly comparing a different period (Conor 2026-07-07: "the summary dials don't look correct").
  const to = f.to ?? (asOf < today ? asOf : today);
  const from = f.from ?? weekStartOf(today);
  return cached(`ds-adviser-league:${from}:${to}`, ttl(config), async () => {
    const prev = previousPeriod({ from, to });
    const [appsRows, refRows, salesRows, revRows, protRows, prevApps, prevRefs] = await Promise.all([
      q<AdviserDailyCount>(config, kpiDailyByAdviser("applications", from, to)),
      q<AdviserDailyCount>(config, kpiDailyByAdviser("referrals", from, to)),
      q<AdviserDailyCount>(config, kpiDailyByAdviser("sales", from, to)),
      q<AdviserRevenue>(config, revenueByAdviser(from, to)),
      q<momentumQ.ProtectionWrittenDaily>(config, momentumQ.protectionWrittenDaily(from, to)),
      q<AdviserDailyCount>(config, kpiDailyByAdviser("applications", prev.from, prev.to)),
      q<AdviserDailyCount>(config, kpiDailyByAdviser("referrals", prev.from, prev.to)),
    ]);

    const weekdays = Math.max(1, weekdaysBetween(from, to));

    interface Row {
      name: string;
      username: string | null;
      office: string;
      apps: number;
      refs: number;
      sales: number;
      avgPerDay: number | null;
      trend: number[];
      trendDir: "up" | "flat" | "down";
    }

    // Weekly application counts per adviser → sparkline + direction.
    const weekKeys: string[] = [];
    for (let d = weekStartOf(from); d <= to; d = shiftDays(d, 7)) weekKeys.push(weekStartOf(d));

    const byName = new Map<string, Row>();
    const rowFor = (username: string | null, fullName: string | null): Row => {
      const name = fullName?.trim() || username || "Unknown";
      let r = byName.get(name);
      if (!r) {
        r = {
          name,
          username,
          office: officeOf(username),
          apps: 0,
          refs: 0,
          sales: 0,
          avgPerDay: null,
          trend: weekKeys.map(() => 0),
          trendDir: "flat",
        };
        byName.set(name, r);
      }
      return r;
    };
    for (const r of appsRows) {
      const row = rowFor(r.username, r.fullName);
      row.apps += r.n;
      const wk = weekKeys.indexOf(weekStartOf(isoDay(r.d)));
      if (wk >= 0) row.trend[wk] += r.n;
    }
    for (const r of refRows) rowFor(r.username, r.fullName).refs += r.n;
    for (const r of salesRows) rowFor(r.username, r.fullName).sales += r.n;

    for (const row of byName.values()) {
      row.avgPerDay = round(row.apps / weekdays, 2);
      const half = Math.floor(row.trend.length / 2);
      const first = sum(row.trend.slice(0, half));
      const second = sum(row.trend.slice(half));
      row.trendDir = second > first * 1.15 ? "up" : second < first * 0.85 ? "down" : "flat";
    }

    // Est. Revenue, itemised into its three real parts. Kyle asked twice what sat behind it
    // ("haven't been given an answer on what Commission £146.6K + Fees £18.6K relates to? What
    // Fees?", 2026-08-06) and then "doesn't appear to have Mortgage and Protection Written split
    // out….can this be done". Both are the same underlying complaint: a total with no visible
    // composition. So the parts are returned separately and the tile shows them.
    //
    //   mortgageWritten   — procuration fee on mortgage cases written in the window
    //   protectionWritten — commission on protection cases submitted in the window (was MISSING
    //                       entirely from this tile, which is why it wouldn't split)
    //   clientFees        — the advice/arrangement fee charged to the CLIENT. Not solicitor fees,
    //                       not miscellaneous fees; those are separate columns and excluded.
    //
    // Mortgage + protection commission is the same pair Capricorn's Total Written Report shows side
    // by side, so the two are directly comparable. Client fees are the deliberate extra on top —
    // that is what makes this WIDER than Momentum's "Weekly Written", which is commission only.
    const mortgageWritten = sum(revRows.map((r) => r.commission ?? 0));
    const protectionWritten = sum(protRows.map((r) => r.commission ?? 0));
    const clientFees = sum(revRows.map((r) => r.clientFees ?? 0));
    const commission = mortgageWritten + protectionWritten;
    const revenue = commission + clientFees;
    const totalApps = sum([...byName.values()].map((r) => r.apps));
    const totalRefs = sum([...byName.values()].map((r) => r.refs));
    const totalSales = sum([...byName.values()].map((r) => r.sales));

    const rows = [...byName.values()].sort((a, b) => b.apps - a.apps || b.refs - a.refs);

    // Most improved: apps+refs this window vs the immediately preceding window.
    const prevByName = new Map<string, { apps: number; refs: number }>();
    const prevFor = (username: string | null, fullName: string | null) => {
      const name = fullName?.trim() || username || "Unknown";
      let r = prevByName.get(name);
      if (!r) {
        r = { apps: 0, refs: 0 };
        prevByName.set(name, r);
      }
      return r;
    };
    for (const r of prevApps) prevFor(r.username, r.fullName).apps += r.n;
    for (const r of prevRefs) prevFor(r.username, r.fullName).refs += r.n;

    // Ranking compares an extrapolated week-to-date estimate against last period's COMPLETE total —
    // only for the default (unfiltered) current week, and only while it's genuinely still in
    // progress. Otherwise Monday's one day always reads as "down" against last week's Friday-
    // complete total, which isn't a real regression (Conor 2026-07-07: "the current week always
    // looks low ... until the final hour"). Displayed apps/refs stay raw — only the ranking math
    // is pace-adjusted, same split as Momentum's "est." point vs its raw KPI cards.
    const improvedFraction = !f.from && !f.to && to === asOf ? weekElapsedFraction(asOf) : 1;

    const improved = rows
      .map((r) => {
        const p = prevByName.get(r.name) ?? { apps: 0, refs: 0 };
        const thisPaced = improvedFraction > 0 ? (r.apps + r.refs) / improvedFraction : r.apps + r.refs;
        const deltaPct = pctDelta(thisPaced, p.apps + p.refs);
        return { name: r.name, office: r.office, thisApps: r.apps, thisRefs: r.refs, lastApps: p.apps, lastRefs: p.refs, deltaPct, thisPaced };
      })
      // Floor is on the PACED estimate too — a raw floor would keep this empty all Monday/Tuesday
      // regardless of the extrapolation above, which is the exact complaint, not a fix for it.
      .filter((r) => r.thisPaced >= 3 && r.deltaPct != null && r.deltaPct > 0)
      .sort((a, b) => (b.deltaPct ?? 0) - (a.deltaPct ?? 0))
      .slice(0, 6);

    // Focus This Month: low application activity (with the "apps low, refs strong" mixed signal).
    const focus = rows
      .filter((r) => r.apps <= LEAGUE.focusAppsThreshold)
      .sort((a, b) => a.apps - b.apps || a.refs - b.refs)
      .slice(0, 6)
      .map((r) => ({
        name: r.name,
        office: r.office,
        apps: r.apps,
        refs: r.refs,
        note: r.refs >= r.apps * LEAGUE.mixedSignalRefsPerApp && r.refs > 2 ? "apps low, refs strong" : "low activity",
        trendDir: r.trendDir,
      }));

    return {
      window: { from, to, weekdays, weeks: weekKeys.length },
      totals: {
        applications: totalApps,
        referrals: totalRefs,
        sales: totalSales,
        revenue: Math.round(revenue),
        commission: Math.round(commission),
        mortgageWritten: Math.round(mortgageWritten),
        protectionWritten: Math.round(protectionWritten),
        clientFees: Math.round(clientFees),
        avgConversion: round(divide(totalRefs, totalApps), 3),
      },
      top: rows.slice(0, 8).map((r) => ({
        name: r.name,
        office: r.office,
        apps: r.apps,
        refs: r.refs,
        sales: r.sales,
        avgPerDay: r.avgPerDay,
        trend: r.trend,
        trendDir: r.trendDir,
      })),
      improved,
      focus,
    };
  });
}

// ---------------------------------------------------------------------------
// Screen 4 — Funnel Health
// ---------------------------------------------------------------------------

export async function funnelHealth(config: Config, f: ReportFilters) {
  const lakeAsOf = await dataAsOf(config);
  // Window: an explicit date range (dashboard filter) wins; else the current month to date.
  const from = f.from ?? mtdPacing(lakeAsOf).windowStart;
  const to = f.to ?? lakeAsOf;
  // Never beyond the freshest loaded day.
  const asOf = to < lakeAsOf ? to : lakeAsOf;
  return cached(`ds-funnel-health:${from}:${to}`, ttl(config), async () => {
    // Applications-vs-referrals gap chart (item 9, reframed): weekly volumes over recent weeks,
    // the same Sat-Fri bucketing Market Momentum uses (not its code, just the pattern) — the
    // visual gap between the two lines IS the unreferred opportunity, replacing the old
    // referred/not-yet-referred proportion donut entirely.
    const gapWeekStarts = weekStartsFor(asOf, f.from, 13);
    const gapFrom = gapWeekStarts[0];
    const [stagesRows, referralsDaily, salesDaily, gapAppsRows, gapRefsRows] = await Promise.all([
      q<funnelQ.MortgageStageCounts>(config, funnelQ.mortgageStageCounts(from, to)),
      q<DailyCount>(config, kpiDaily("referrals", from, to)),
      q<DailyCount>(config, kpiDaily("sales", from, to)),
      q<DailyCount>(config, kpiDaily("applications", gapFrom, asOf)),
      q<DailyCount>(config, kpiDaily("referrals", gapFrom, asOf)),
    ]);

    const gapWeekIndex = (d: string): number => gapWeekStarts.indexOf(weekStartOf(d));
    const bucketWeekly = (rows: DailyCount[]): number[] => {
      const out = gapWeekStarts.map(() => 0);
      for (const r of rows) {
        const i = gapWeekIndex(isoDay(r.d));
        if (i >= 0) out[i] += r.n;
      }
      return out;
    };
    const gapWeekLabels = gapWeekStarts.map((w) => `W${isoWeekNo(shiftDays(w, 2))}`);

    const s = stagesRows[0] ?? { leads: 0, applications: 0, offers: 0 };
    const referrals = sum(referralsDaily.map((r) => r.n));
    const sales = sum(salesDaily.map((r) => r.n));
    const stages = [
      { key: "leads", label: "Leads", count: s.leads },
      { key: "applications", label: "Mortgages Written", count: s.applications },
      { key: "offers", label: "Offers", count: s.offers },
      { key: "referrals", label: "Protection Opportunities", count: referrals },
      { key: "sales", label: "Protection Sales", count: sales },
    ];
    // Each stage's share of TOTAL LEADS in the period — deliberately NOT a stage-to-stage case
    // conversion (Conor 2026-07-07: offers lag applications, so a same-window apps→offers ratio
    // looks artificially low; "gross apps" and "gross offers" should be shown as dissociated
    // volumes, expressed as % of total value, not individual-case conversion tracking).
    const leadsBase = s.leads;
    const shareOfLeads = (n: number): number => (leadsBase > 0 ? round((n / leadsBase) * 100, 0) ?? 0 : 0);
    const conversions = stages.slice(0, -1).map((st, i) => ({
      from: st.key,
      to: stages[i + 1].key,
      pct: shareOfLeads(stages[i + 1].count),
    }));

    return {
      dataAsOf: asOf,
      window: { from, to: asOf },
      stages,
      conversions,
      applicationsReferralsGap: {
        weeks: gapWeekLabels,
        applications: bucketWeekly(gapAppsRows),
        referrals: bucketWeekly(gapRefsRows),
      },
    };
  });
}

// ---------------------------------------------------------------------------
// Screen 5 — Market Momentum
// ---------------------------------------------------------------------------

export async function marketMomentum(config: Config, f: ReportFilters) {
  const lakeAsOf = await dataAsOf(config);
  // Trend end = an explicit `to` (dashboard filter), capped at the freshest day; default = latest.
  const asOf = f.to && f.to < lakeAsOf ? f.to : lakeAsOf;
  // Weeks: an explicit range → whole ISO weeks spanning [from, to]; else rolling 13 weeks.
  const weekStarts = weekStartsFor(asOf, f.from, 13);
  const from = weekStarts[0];
  return cached(`ds-market-momentum:${from}:${asOf}`, ttl(config), async () => {
    const [leads, apps, refs, revenue, protWritten] = await Promise.all([
      q<DailyCount>(config, kpiDaily("leads", from, asOf)),
      q<DailyCount>(config, kpiDaily("applications", from, asOf)),
      q<DailyCount>(config, kpiDaily("referrals", from, asOf)),
      q<momentumQ.RevenueDaily>(config, momentumQ.revenueDaily(from, asOf)),
      q<momentumQ.ProtectionWrittenDaily>(config, momentumQ.protectionWrittenDaily(from, asOf)),
    ]);

    const weekIndex = (d: string): number => weekStarts.indexOf(weekStartOf(d));
    const bucket = (rows: DailyCount[]): number[] => {
      const out = weekStarts.map(() => 0);
      for (const r of rows) {
        const i = weekIndex(isoDay(r.d));
        if (i >= 0) out[i] += r.n;
      }
      return out;
    };

    const leadsW = bucket(leads);
    const appsW = bucket(apps);
    const refsW = bucket(refs);
    const valW = weekStarts.map(() => 0);
    const casesW = weekStarts.map(() => 0);
    // Written business = written COMMISSION (Kyle 2026-07-15). Mortgage written = commission ONLY —
    // client fees are carried separately (feeW) because Capricorn's Total Written report is a
    // commission report; folding fees in silently inflated the board against it (Kyle 2026-07-28).
    // Loan value (valW → Avg Case Size, and the Daily Run Chase "Total Lending" tile) is shown
    // SEPARATELY, never as "written".
    const mortW = weekStarts.map(() => 0);
    const feeW = weekStarts.map(() => 0);
    for (const r of revenue) {
      const i = weekIndex(isoDay(r.d));
      if (i < 0) continue;
      valW[i] += r.totalValue ?? 0;
      casesW[i] += r.cases;
      mortW[i] += r.commission ?? 0;
      feeW[i] += r.clientFees ?? 0;
    }
    // Protection written is now SOURCED (protectioncase.ProductCommission) rather than hardcoded
    // £0, which understated combined written by ~£24k/wk. Still INDICATIVE: it reads ~£21–24k/wk
    // against Kyle's previously quoted ~£41k/wk, an open question with him (2026-07-29).
    const insW = weekStarts.map(() => 0);
    for (const r of protWritten) {
      const i = weekIndex(isoDay(r.d));
      if (i < 0) continue;
      insW[i] += r.commission ?? 0;
    }
    const combW = mortW.map((m, i) => m + insW[i]);
    const avgCaseW = casesW.map((n, i) => (n > 0 ? valW[i] / n : null));
    const refRateW = appsW.map((n, i) => (n > 0 ? (refsW[i] / n) * 100 : null));

    // weekStarts are Saturdays (Capricorn's reporting-week anchor) — feed isoWeekNo the Monday
    // within that bucket so the label reflects the real ISO-8601 week number.
    const weeks = weekStarts.map((w) => `W${isoWeekNo(shiftDays(w, 2))}`);

    // The chase week (last bucket) is usually partial. Weighted business-day fraction elapsed so
    // far this week (same Mon–Fri weighting as the run chase — Fri counts less) — used both to
    // exclude the partial week from deltas/quarter-avg (as before) AND, per Conor 2026-07-07, to
    // EXTRAPOLATE the volume series' last point to a full-week estimate so the trend line doesn't
    // visually "dip" every week until Friday. Sat/Sun asOf = the business week is already complete.
    const weekFraction = weekElapsedFraction(asOf);
    const partialLast = weekFraction < 1;
    const li = partialLast ? weekStarts.length - 2 : weekStarts.length - 1;
    const lastIdx = weekStarts.length - 1;

    // LIKE-FOR-LIKE week-to-date buckets: each week summed only through the SAME weekday the current
    // week has reached. Kyle, 2026-08-07: "Don't we want to compare current week to prior week? I'd
    // have current week i.e. WK32 compared to WK31 and show the difference … so we can track if we
    // are performing better than the prior week." He is right that the current week belongs in the
    // headline — but a part-week against a whole week always reads as a collapse, which is the
    // complaint he raised on 28 July in the other direction. Truncating BOTH weeks to the same day
    // gives him the comparison he asked for and keeps it fair: Sat-Thu against Sat-Thu.
    const throughIdx = weekDayIndex(asOf); // 0=Sat … 6=Fri
    const ltdBucket = (rows: DailyCount[]): number[] => {
      const out = weekStarts.map(() => 0);
      for (const r of rows) {
        const d = isoDay(r.d);
        const i = weekIndex(d);
        if (i < 0) continue;
        if (d > shiftDays(weekStarts[i], throughIdx)) continue; // past the same point in that week
        out[i] += r.n;
      }
      return out;
    };
    const ltdMoney = (rows: Array<{ d: string; commission: number | null }>): number[] => {
      const out = weekStarts.map(() => 0);
      for (const r of rows) {
        const d = isoDay(r.d);
        const i = weekIndex(d);
        if (i < 0) continue;
        if (d > shiftDays(weekStarts[i], throughIdx)) continue;
        out[i] += r.commission ?? 0;
      }
      return out;
    };
    const leadsLtd = ltdBucket(leads);
    const appsLtd = ltdBucket(apps);
    const refsLtd = ltdBucket(refs);
    const writtenLtd = ltdMoney(revenue as Array<{ d: string; commission: number | null }>).map(
      (v, i) => v + ltdMoney(protWritten as Array<{ d: string; commission: number | null }>)[i],
    );
    // Avg case size is a ratio, so BOTH sides get truncated to the same day and it is rebuilt from
    // them. Without this it would be the one tile still reporting last week while the other four
    // report this week — precisely the "screens disagree" reading we are trying to stop.
    const valLtd = weekStarts.map(() => 0);
    const casesLtd = weekStarts.map(() => 0);
    for (const r of revenue) {
      const d = isoDay(r.d);
      const i = weekIndex(d);
      if (i < 0 || d > shiftDays(weekStarts[i], throughIdx)) continue;
      valLtd[i] += r.totalValue ?? 0;
      casesLtd[i] += r.cases;
    }
    const avgCaseLtd = casesLtd.map((n, i) => (n > 0 ? valLtd[i] / n : 0));

    if (partialLast && weekFraction > 0) {
      // Volume/count series: scale the partial week up to a like-for-like full-week estimate.
      // Ratio series (avg case size, referral rate) are untouched — extrapolating both the
      // numerator and denominator by the same factor leaves a ratio unchanged, so there's nothing
      // to fix there. Weekly Revenue is deliberately EXCLUDED here — see the day-by-day forecast
      // below (item 12, reframed 2026-07-07): a flat scale-up is a worse model for revenue
      // specifically once a per-weekday forecast is available, and Conor's ask was revenue-only.
      for (const series of [leadsW, appsW, refsW]) {
        series[lastIdx] = Math.round(series[lastIdx] / weekFraction);
      }
    }

    // Weekly Revenue forecast (item 12, reframed): actuals stop at the last COMPLETE week — no
    // extrapolated point pretending to be real. The current, partial week instead gets
    // actual-so-far + a forecast for each REMAINING weekday, each estimated from that specific
    // weekday's own trailing average (last 6 occurrences in the fetched window) rather than a flat
    // proportional scale-up — it shrinks toward the true total as real days land through the week.
    // Only touches Weekly Revenue; the other 3 series keep the simpler flat scale-up above.
    // Combined (mortgage + protection) written commission per day — the forecast's own history.
    const combinedByDay = new Map<string, number>();
    for (const r of revenue) {
      const d = isoDay(r.d);
      combinedByDay.set(d, (combinedByDay.get(d) ?? 0) + (r.commission ?? 0));
    }
    for (const r of protWritten) {
      const d = isoDay(r.d);
      combinedByDay.set(d, (combinedByDay.get(d) ?? 0) + (r.commission ?? 0));
    }
    const writtenCombinedDaily = [...combinedByDay.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([d, v]) => ({ d, v }));
    let writtenForecastTotal: number | null = null;
    if (partialLast && weekFraction > 0) {
      const currentWeekEnd = shiftDays(weekStarts[lastIdx], 6); // Friday
      let remainingForecast = 0;
      for (let d = shiftDays(asOf, 1); d <= currentWeekEnd; d = shiftDays(d, 1)) {
        const targetDow = new Date(`${d}T00:00:00Z`).getUTCDay();
        const trailing = writtenCombinedDaily
          .filter((r) => new Date(`${r.d}T00:00:00Z`).getUTCDay() === targetDow)
          .slice(-6)
          .map((r) => r.v);
        remainingForecast += trailing.length ? sum(trailing) / trailing.length : 0;
      }
      writtenForecastTotal = Math.round(combW[lastIdx] + remainingForecast);
    }
    // Actual line stops before the partial week; a separate two-point segment (last complete
    // week's actual → the blended forecast) renders as a dashed "chipping away" projection.
    const writtenActualK = combW.map((v, i) => (partialLast && i === lastIdx ? null : round(v / 1000, 1)));
    const writtenForecastK = weekStarts.map((_, i) => {
      if (!partialLast) return null;
      if (i === lastIdx - 1) return round(combW[lastIdx - 1] / 1000, 1);
      if (i === lastIdx) return writtenForecastTotal != null ? round(writtenForecastTotal / 1000, 1) : null;
      return null;
    });
    const quarterAvg = (xs: Array<number | null>): number | null => {
      const usable = xs.slice(0, li + 1).filter((x): x is number => x != null);
      return usable.length ? sum(usable) / usable.length : null;
    };
    // Every tile carries its ACTUAL date range, not just "W30". The tiles report the last COMPLETE
    // Sat–Fri week while the run-chase screens report the current one, and a bare week number gave
    // no way to tell — Kyle read a full week (18–24 Jul) as "3 days" and reconciled it against a
    // 25–28 Jul report that shares no days with it (2026-07-28).
    const windowOf = (i: number) => ({ from: weekStarts[i], to: shiftDays(weekStarts[i], 6) });
    // WrittenDate-keyed measures keep climbing for days after the week ends (INPUT_LAG_SETTLE_DAYS);
    // LeadDate/CreatedDate-keyed ones (leads, referrals) land same-day and are settled on close.
    const WRITTEN_DATE_KEYED = new Set(["applications", "written", "case-size"]);
    // `ltd` = the like-for-like week-to-date series for this measure (null for ratio measures, where
    // truncating numerator and denominator by the same days changes nothing worth showing).
    const kpi = (
      key: string,
      label: string,
      series: Array<number | null>,
      fmt: "int" | "gbp" | "gbpk",
      ltd?: number[],
    ) => {
      const qa = quarterAvg(series);
      // HEADLINE = the current week to date; COMPARISON = the prior week to the same weekday.
      // Falls back to whole-week-vs-whole-week when the last bucket is already complete (Friday
      // evening onwards) or when the measure has no like-for-like series.
      const useLtd = partialLast && ltd != null;
      const headIdx = useLtd ? lastIdx : li;
      const latest = useLtd ? ltd[lastIdx] : (series[li] ?? null);
      const prior = useLtd ? (ltd[lastIdx - 1] ?? null) : (series[li - 1] ?? null);
      const w = windowOf(headIdx);
      return {
        key,
        label,
        fmt,
        latest,
        weekLabel: weeks[headIdx],
        weekFrom: w.from,
        weekTo: w.to,
        /** True when `latest` is a part-week measured against the prior week's SAME days. */
        likeForLike: useLtd,
        /** Last day included in both sides of the comparison. */
        throughDay: useLtd ? asOf : w.to,
        priorWeekLabel: headIdx > 0 ? weeks[headIdx - 1] : null,
        provisional: WRITTEN_DATE_KEYED.has(key) && shiftDays(w.to, INPUT_LAG_SETTLE_DAYS) > asOf,
        // The last COMPLETE week, kept alongside so a full-week number is always available — it is
        // the only one comparable with the quarter average.
        lastFullWeek: partialLast
          ? { weekLabel: weeks[li], weekFrom: windowOf(li).from, weekTo: windowOf(li).to, value: series[li] ?? null }
          : null,
        delta: latest != null && prior != null ? round(latest - prior, 1) : null,
        deltaPct: latest != null && prior != null ? pctDelta(latest, prior) : null,
        // Quarter average is a WHOLE-week measure, so it stays anchored to the last complete week —
        // comparing four days against a 13-week average of full weeks would always read as behind.
        vsQuarterPct: series[li] != null && qa ? round((((series[li] as number) - qa) / qa) * 100, 1) : null,
      };
    };

    const kpis = [
      // "Mortgages Written", not "Applications": this counts mortgagecase rows by WrittenDate, i.e.
      // business written, not applications submitted (Kyle read it as the latter, 2026-07-28).
      kpi("applications", "Mortgages Written", appsW, "int", appsLtd),
      kpi("referrals", "Protection Opportunities", refsW, "int", refsLtd),
      kpi("written", "Weekly Written", combW, "gbpk", writtenLtd),
      kpi("leads", "Lead Volume", leadsW, "int", leadsLtd),
      kpi("case-size", "Avg Case Size", avgCaseW, "gbpk", avgCaseLtd),
    ];

    // Verdict bar: majority of headline series improving vs the quarter average?
    const signals = kpis.map((k) => k.vsQuarterPct).filter((x): x is number => x != null);
    const up = signals.filter((x) => x > 2).length;
    const down = signals.filter((x) => x < -2).length;
    const verdict =
      up > down
        ? "Momentum building — most measures ahead of the quarter average."
        : down > up
          ? "Momentum softening — most measures behind the quarter average."
          : "Holding steady — measures tracking the quarter average.";

    // Written vs target (Kyle 2026-07-14/15): Mortgage shown target-vs-actual; Insurance carried but
    // hidden on the board until its actual is sourced. Reference the last week that has genuinely
    // ENDED (its Saturday start is before THIS reporting week) AND is fully data-loaded (Friday ≤
    // dataAsOf) — not `li`. Otherwise the in-progress week (e.g. mid-Friday) reads as complete and
    // understates the actual against a full-week target (~23% of a week-in-progress vs the true ~45%).
    const currentWeekStart = weekStartOf(tzToday(new Date(), config.reporting.timeZone));
    let completeIdx = 0;
    for (let i = weekStarts.length - 1; i >= 0; i--) {
      if (weekStarts[i] < currentWeekStart && shiftDays(weekStarts[i], 6) <= asOf) { completeIdx = i; break; }
    }
    const writtenTargets = getWrittenWeeklyTargets();
    const writtenTargetCombined = writtenTargets.mortgage + writtenTargets.insurance;
    const writtenWindow = windowOf(completeIdx);
    const writtenBlock = {
      weekLabel: weeks[completeIdx],
      weekFrom: writtenWindow.from,
      weekTo: writtenWindow.to,
      mortgage: { actual: Math.round(mortW[completeIdx] ?? 0), target: Math.round(writtenTargets.mortgage) },
      insurance: { actual: Math.round(insW[completeIdx] ?? 0), target: Math.round(writtenTargets.insurance) },
      combined: { actual: Math.round(combW[completeIdx] ?? 0), target: Math.round(writtenTargetCombined) },
      /** Client fees written in the same week — NOT part of "written" (which is commission), shown
       *  so the gap to a fees-inclusive figure like Est. Revenue is explicit, not mysterious. */
      clientFees: Math.round(feeW[completeIdx] ?? 0),
      /** Cases written whose WrittenDate falls in the week but were input later. Mean input lag is
       *  ~6 days and 22% of written £ arrives 8+ days late, so a just-closed week keeps climbing:
       *  W30 read £266.3k/133 on 28 Jul and £299.6k/147 on 29 Jul. The board must say "provisional"
       *  rather than imply a closed week is final (Kyle 2026-07-28). */
      provisional: shiftDays(writtenWindow.to, INPUT_LAG_SETTLE_DAYS) > asOf,
    };

    return {
      dataAsOf: asOf,
      weeks,
      partialLastWeek: partialLast,
      series: {
        applications: appsW,
        referrals: refsW,
        writtenActualK,
        writtenForecastK,
        leads: leadsW,
        avgCaseSizeK: avgCaseW.map((v) => (v == null ? null : round(v / 1000, 0))),
        referralRatePct: refRateW.map((v) => (v == null ? null : round(v, 1))),
      },
      written: writtenBlock,
      /** Combined weekly written target, £k — the reference line on the Weekly Written trend. */
      writtenTargetCombinedK: round(writtenTargetCombined / 1000, 1),
      kpis,
      referralRateTargetPct: REFERRAL_RATE_TARGET * 100,
      verdict,
    };
  });
}

// ---------------------------------------------------------------------------
// live-feed — the ticker
// ---------------------------------------------------------------------------

const gbp = (v: number | null | undefined): string =>
  v == null ? "" : `£${Math.round(v) >= 1000 ? `${Math.round(v / 1000)}k` : Math.round(v)}`;

export interface FeedItem {
  kind: "application" | "lead" | "referral" | "sale" | "milestone";
  icon: string;
  text: string;
  accent: "none" | "green" | "gold";
}

export async function liveFeed(config: Config, _f: ReportFilters) {
  return cached("ds-live-feed", ttl(config), async () => {
    const core = await chaseCore(config);
    // Source events from the latest WORKING day (a weekend anchor has almost no activity). The
    // lake reloads 5× daily, so this is honestly "latest activity", not live-now.
    const asOf = core.ctx.latestDay;
    const [apps, leads, refs, sales] = await Promise.all([
      q<tickerQ.ApplicationEvent>(config, tickerQ.applicationEvents(asOf, 15)),
      q<tickerQ.LeadEvent>(config, tickerQ.leadEvents(asOf, 12)),
      q<tickerQ.ReferralEvent>(config, tickerQ.referralEvents(asOf, 10)),
      q<tickerQ.SaleEvent>(config, tickerQ.saleEvents(asOf, 10)),
    ]);

    const dayLabel = new Intl.DateTimeFormat("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    }).format(new Date(`${asOf}T00:00:00Z`));

    type Item = FeedItem;
    const first = (name: string | null): string => {
      if (!name) return "Adviser";
      const parts = name.trim().split(/\s+/);
      return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}` : parts[0];
    };
    const officeSuffix = (username: string | null): string => {
      const office = officeOf(username);
      return office === UNASSIGNED ? "" : ` · ${office}`;
    };

    const events: Item[] = [
      ...apps.map((e): Item => ({
        kind: "application",
        icon: "🏡",
        text: `${first(e.fullName)}${officeSuffix(e.username)} · ${gbp(e.mortgageValue)} application${e.lenderName ? ` · ${e.lenderName}` : ""}`,
        accent: "none",
      })),
      ...sales.map((e): Item => ({
        kind: "sale",
        icon: "⭐",
        text: `${first(e.fullName)}${officeSuffix(e.username)} · protection sale completed${e.policyAmount ? ` · ${gbp(e.policyAmount)} cover` : ""}`,
        accent: "gold",
      })),
      ...refs.map((e): Item => ({
        kind: "referral",
        icon: "🛡️",
        text: `${first(e.fullName)}${officeSuffix(e.username)} · protection opportunity referred`,
        accent: "green",
      })),
      ...leads.map((e): Item => ({
        kind: "lead",
        icon: "🔥",
        text: `${first(e.fullName)}${officeSuffix(e.username)} · new lead${e.introducer ? ` · ${e.introducer}` : ""}`,
        accent: "none",
      })),
    ];

    // Milestones from the chase state — the "story of the week" lines between events.
    const milestones: Item[] = [];
    const dailyTargets = getDailyTargets();
    for (const k of KPI_KEYS) {
      const weekly = dailyTargets[k] * 5;
      const wtd = sum(weekRows(core.daily[k], core.ctx).map((r) => r.n));
      const pace = computePace(weekly, wtd, core.ctx.fraction);
      if (pace.status !== "on_pace") {
        milestones.push({
          kind: "milestone",
          icon: pace.status === "ahead" ? "📈" : "📉",
          text: `${KPI_LABELS[k]}: ${Math.abs(pace.aheadBehind)} ${pace.status === "ahead" ? "ahead of" : "behind"} weekly pace`,
          accent: pace.status === "ahead" ? "green" : "none",
        });
      }
      const latestN = dayTotal(core.daily[k], asOf);
      if (latestN > 0) {
        milestones.push({
          kind: "milestone",
          icon: "🎯",
          text: `${latestN} ${KPI_LABELS[k].toLowerCase()} on ${dayLabel}`,
          accent: "none",
        });
      }
    }
    const officeDailyTargets = getOfficeDailyTargets();
    const officePaces = officeAggregates(core)
      .map((o) => ({ office: o.office, pct: pctToPace(o.mtd, officeDailyTargets[o.office] ?? emptyKpiRecord(), core.ctx) }))
      .filter((o) => o.pct != null)
      .sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0));
    if (officePaces[0]) {
      milestones.push({
        kind: "milestone",
        icon: "🏆",
        text: `${officePaces[0].office} leading — ${officePaces[0].pct}% of pace`,
        accent: "gold",
      });
    }

    // Interleave: a milestone roughly every 4 events.
    const items: Item[] = [];
    let mi = 0;
    events.forEach((e, i) => {
      items.push(e);
      if ((i + 1) % 4 === 0 && mi < milestones.length) items.push(milestones[mi++]);
    });
    while (mi < milestones.length) items.push(milestones[mi++]);

    return { dataAsOf: asOf, dayLabel, items };
  });
}

// ---------------------------------------------------------------------------
// Screen 6 — Reconciliation
// ---------------------------------------------------------------------------

/**
 * The screen that is meant to end the email thread.
 *
 * Three separate arguments with Capricorn's CFO ran for a fortnight, and none of them was about a
 * number being wrong:
 *
 *   1. SCOPE. Their Total Written Report runs inside one regulated entity; the board reports the
 *      group. £384,402 vs £413,541 for Sat 25-31 Jul — a £32k "discrepancy" that was two correct
 *      answers to different questions. So both are shown, always, side by side.
 *   2. BASIS. Which date column, which statuses. Answered by email four times. Now printed on the
 *      screen next to the figure it produces.
 *   3. MOVEMENT. A closed week reported £68,951 on 4 Aug and £64,341.82 on 10 Aug. Nobody could see
 *      that had happened, including us. Now the week carries its own history.
 *
 * Live figures come from the SAME function the snapshot recorder uses (`observeWeeks`), not a
 * parallel implementation — if this screen and the stored history ever disagreed about what the
 * board says today, it would be worse than having no screen at all.
 */
export async function reconciliation(config: Config, f: ReportFilters) {
  const asOf = await dataAsOf(config);
  const today = tzToday(new Date(), config.reporting.timeZone);
  // Default to the last COMPLETE week — the one Capricorn's own report is usually run for. An
  // explicit `from` (the dashboard date filter) selects the week containing it.
  const selected = f.from ? weekStartOf(f.from) : shiftDays(weekStartOf(today), -7);
  return cached(`ds-reconciliation:${selected}`, ttl(config), async () => {
    const closed = closedWeekStarts(today);
    const weeks = closed.includes(selected) ? closed : [...closed, selected].sort();
    const loadedAt = await lastRefreshAt(config);

    const [live, revisions] = await Promise.all([
      observeWeeks(config, [selected], loadedAt, new Date().toISOString()),
      loadRevisions(config, weeks),
    ]);

    const byWeek = new Map(revisions.map((r) => [r.weekStart, r]));
    const observation = live.get(selected) ?? null;
    const revision = byWeek.get(selected) ?? null;

    const weekLabel = (w: string) => `W${isoWeekNo(shiftDays(w, 2))}`;
    const settle = settleThrough(shiftDays(selected, 6));

    return {
      dataAsOf: asOf,
      lakeLoadedAt: loadedAt,
      snapshotsEnabled: Boolean(config.snapshots.storageAccount),
      week: {
        start: selected,
        end: shiftDays(selected, 6),
        label: weekLabel(selected),
        /** Movement up to this date is ordinary input lag; after it, someone has to explain it. */
        settleThrough: settle,
        provisional: settle > asOf,
      },
      /** Every observed week, newest first — the selector, and an at-a-glance list of which ones
       *  have moved. */
      weeks: weeks
        .map((w) => {
          const r = byWeek.get(w);
          return {
            start: w,
            end: shiftDays(w, 6),
            label: weekLabel(w),
            severity: r?.severity ?? "none",
            changes: r?.changes ?? 0,
            observed: r != null,
          };
        })
        .reverse(),
      /** What the board reports for this week right now, group and per entity. */
      live: observation
        ? {
            observedAt: observation.observedAt,
            group: observation.group,
            byOrg: ORGANISATIONS.map((o) => ({
              key: o.key,
              name: o.name,
              shortName: o.shortName,
              figures: observation.byOrg[String(o.key)] ?? null,
            })),
          }
        : null,
      /** How this week has moved since first recorded — null until it has been observed twice. */
      revision,
      /** The full recorded history for the selected week, oldest first. */
      history: revision
        ? [...new Set([revision.first, revision.latest])].map((o) => ({
            observedAt: o.observedAt,
            lakeLoadedAt: o.lakeLoadedAt,
            group: o.group,
          }))
        : [],
      /** Weeks whose movement input lag does not explain — what the board should be shouting about. */
      alerts: revisions.filter((r) => needsExplaining(r)).map((r) => ({
        weekStart: r.weekStart,
        weekEnd: r.weekEnd,
        label: weekLabel(r.weekStart),
        severity: r.severity,
        deltas: r.deltas,
        lastChangedAt: r.lastChangedAt,
      })),
      /** The rule behind each figure, printed rather than emailed. */
      basis: {
        mortgage: {
          label: "Mortgage commission written",
          rule: `mortgagecase.${MORTGAGE_WRITTEN_DATE} within the week, ProductCommission summed, deleted cases excluded.`,
          source: METRIC_DEFINITIONS.find((m) => m.key === "written")?.source ?? null,
        },
        protection: {
          label: "Protection commission written",
          rule: `protectioncase.${PROTECTION_WRITTEN_DATE} (the platform's "Date Submitted") within the week, WorkflowStatusId in ${PROTECTION_WRITTEN_STATUSES.join("/")}, ProductCommission summed.`,
          source: METRIC_DEFINITIONS.find((m) => m.key === "sales")?.source ?? null,
        },
        clientFees: {
          label: "Client fees",
          rule: "mortgagecase.ClientFeeAmount — the advice/arrangement fee the adviser enters on the case. Not solicitor or miscellaneous fees. NOT commission, and never counted as written business.",
          source: null,
        },
        scope: {
          label: "Entity scope",
          rule: `The board reports the Capricorn group (${ORGANISATIONS.map((o) => o.name).join(" + ")}). A Total Written Report run inside one entity will show that entity's column here, not the group total.`,
          source: null,
        },
      },
    };
  });
}

// ---------------------------------------------------------------------------
// definitions — THE metric dictionary (Conor 2026-08-04: every KPI clickable)
// ---------------------------------------------------------------------------

/** The single definition set behind every tile's info panel and the Glossary. Pure config — no lake
 *  round-trip — but served through the dataset layer so the kiosk and the dashboard resolve it the
 *  same way as everything else. */
export async function definitions(_config: Config, _f: ReportFilters) {
  return { cadence: DATA_CADENCE, metrics: METRIC_DEFINITIONS };
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const DATASETS = {
  meta: (config: Config) => meta(config),
  "daily-run-chase": dailyRunChase,
  "office-run-chase": officeRunChase,
  "adviser-league": adviserLeague,
  "funnel-health": funnelHealth,
  "market-momentum": marketMomentum,
  reconciliation,
  "live-feed": liveFeed,
  definitions,
} as const;

export type DatasetName = keyof typeof DATASETS;

export function isDatasetName(name: string): name is DatasetName {
  return name in DATASETS;
}

/** Resolve and run a dataset by name. `meta` ignores filters; the rest take them. */
export async function getDataset(name: DatasetName, config: Config, filters: ReportFilters): Promise<unknown> {
  const loader = DATASETS[name] as (config: Config, filters: ReportFilters) => Promise<unknown>;
  return loader(config, filters ?? EMPTY_FILTERS);
}
