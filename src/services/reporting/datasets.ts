// Dataset facade — the single source both route prefixes (/api/reporting/* behind Easy Auth,
// /api/kiosk token-gated) resolve through. One composite payload per screen; a short server-side
// TTL cache means N wall TVs cost ~one Fabric query set per dataset per TTL.
//
// Chase model (Conor's weekly principles, 2026-07-06): the run chase is WEEK-TO-DATE vs weekly
// targets with weighted days (Mon–Thu 20.83% each, Fri 16.67%), measured through the latest
// complete day in the nightly lake ("data as of"). The week rolls each Monday automatically.
// Funnel volumes remain month-to-date. The pacing seam (pacing.ts) is the single plug-point for a
// future intraday or drip feed and for the live Team-Targets source when Capricorn provides one.

import type { Config } from "../../config.js";
import { OFFICES, UNASSIGNED, officeOf } from "../../domain/offices.js";
import {
  ALERT_THRESHOLDS,
  DAILY_TARGETS,
  dayTarget,
  KPI_KEYS,
  KPI_LABELS,
  LEAGUE,
  OFFICE_DAILY_TARGETS,
  REFERRAL_RATE_TARGET,
  REVENUE_DAILY_TARGET,
  type KpiKey,
  type KpiTargets,
} from "../../domain/targets.js";
import { cached } from "./cache.js";
import { EMPTY_FILTERS, type ReportFilters } from "./filters.js";
import * as funnelQ from "./funnel.js";
import { kpiDaily, kpiDailyByAdviser, type AdviserDailyCount, type DailyCount } from "./kpis.js";
import * as momentumQ from "./momentum.js";
import { chaseStatus, computePace, tzToday, type ChaseStatus, type Pace } from "./pace.js";
import { mtdPacing, weeklyPacing, type WeeklyPacingContext } from "./pacing.js";
import { run, type BuiltQuery } from "./query.js";
import { revenueByAdviser, type AdviserRevenue } from "./advisers.js";
import * as tickerQ from "./ticker.js";
import { monthOf, pctDelta, previousPeriod, shiftDays, weekdaysBetween, weekOf } from "./trends.js";
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

/** Latest complete day in the lake — MAX(LeadDate) (lead creation trails nothing else we chart). */
async function dataAsOf(config: Config): Promise<string> {
  return cached("data-as-of", 5 * 60_000, async () => {
    const rows = await q<{ maxDay: unknown }>(config, {
      text: `SELECT MAX(LeadDate) AS maxDay FROM dbo.mortgagecase WHERE COALESCE(DeletedYN, 'N') <> 'Y';`,
      params: [],
    });
    const v = rows[0]?.maxDay;
    if (!v) throw new Error("Lake returned no MAX(LeadDate) — is GAGold_Capricorn loaded?");
    return isoDay(v);
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

/** Cumulative counts aligned to the week's working days. Weekend activity (rows dated after
 *  Friday) folds into the Friday point once the week is complete; the line is null after the
 *  data-as-of day (it stops at the present). */
function cumulativeSeries(daily: DailyCount[], days: string[], asOf: string): Array<number | null> {
  const byDay = new Map<string, number>();
  for (const r of daily) {
    const d = isoDay(r.d);
    byDay.set(d, (byDay.get(d) ?? 0) + r.n);
  }
  const allDates = [...byDay.keys()].sort();
  const last = days[days.length - 1];
  let cum = 0;
  let di = 0;
  return days.map((day) => {
    if (day > asOf) return null;
    // The Friday point absorbs any weekend rows when asOf has passed Friday.
    const threshold = day === last && asOf > last ? asOf : day;
    while (di < allDates.length && allDates[di] <= threshold) {
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
      latest[k] = sum(mine.filter((r) => isoDay(r.d) === core.ctx.latestWorkingDay).map((r) => r.n));
      series[k] = cumulativeSeries(dailyMine, days, core.ctx.dataAsOf);
    }
    return { office: name, color, mtd, latest, series };
  });
}

/** % of expected-by-now weekly pace, averaged across the four KPIs. Null when no targets. */
function pctToPace(wtd: KpiTargets, dailyTargets: KpiTargets, ctx: WeeklyPacingContext): number | null {
  const ratios: number[] = [];
  for (const k of KPI_KEYS) {
    const weekly = dailyTargets[k] * 5;
    const expected = weekly * ctx.fraction;
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

export async function meta(config: Config) {
  const asOf = await dataAsOf(config);
  const weekly = Object.fromEntries(KPI_KEYS.map((k) => [k, DAILY_TARGETS[k] * 5])) as KpiTargets;
  return {
    offices: [...OFFICES],
    targets: {
      daily: DAILY_TARGETS,
      weekly,
      officeDaily: OFFICE_DAILY_TARGETS,
      revenueDaily: REVENUE_DAILY_TARGET,
    },
    dataAsOf: asOf,
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

    const kpis = KPI_KEYS.map((k) => {
      const weekly = DAILY_TARGETS[k] * 5;
      const thisWeek = weekRows(core.daily[k], ctx);
      const wtd = sum(thisWeek.map((r) => r.n));
      const pace: Pace = computePace(weekly, wtd, ctx.fraction);
      const actual = cumulativeSeries(thisWeek, days, ctx.dataAsOf);
      // WTD context (for the trend chart + a secondary line): cumulative weekly position in %.
      const actualPct = weekly > 0 ? round((wtd / weekly) * 100, 1) : null;
      const expectedPct = round(ctx.fraction * 100, 1);
      // DAY view (the headline counter, per Conor's 2026-07-06 feedback): the latest WORKING day's
      // actual vs that day's target (weekday-weighted), with a day ahead/behind.
      const dayActual = dayTotal(core.daily[k], ctx.latestWorkingDay);
      const target = dayTarget(weekly, ctx.latestWorkingDayIndex);
      return {
        key: k,
        label: KPI_LABELS[k],
        weeklyTarget: weekly,
        wtd,
        // Week pace — drives the trend chart's header status (the chart is the WTD trend).
        pace,
        day: {
          date: ctx.latestWorkingDay,
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
          targetPace: weeklyTargetPace(weekly, ctx.cumulativeShares),
          projection: projectionSeries(actual, pace.projectedFinish),
        },
      };
    });

    const leaderboard = officeAggregates(core)
      .map((o) => {
        const targets = OFFICE_DAILY_TARGETS[o.office] ?? emptyKpiRecord();
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
      week: {
        start: ctx.windowStart,
        end: ctx.weekDays[4],
        days,
        // Cumulative expected share by end of each day, % (20.83 / 41.67 / 62.5 / 83.33 / 100).
        cumulativeSharesPct: ctx.cumulativeShares.map((s) => round(s * 100, 2)),
        fraction: round(ctx.fraction, 4),
        expectedPct: round(ctx.fraction * 100, 1),
        nowLabel: ctx.nowLabel,
        latestWorkingDay: ctx.latestWorkingDay,
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
    // The pace line is the WEIGHTED cumulative expected share (Fri = 80% of a Mon–Thu day).
    const paceLine = ctx.cumulativeShares.map((s) => Math.round(s * 100));

    const offices = officeAggregates(core)
      .map((o) => {
        const targets = OFFICE_DAILY_TARGETS[o.office] ?? emptyKpiRecord();
        const hasTargets = KPI_KEYS.some((k) => targets[k] > 0);
        const kpis = KPI_KEYS.map((k) => {
          const weekly = targets[k] * 5;
          const pace = computePace(weekly, o.mtd[k], ctx.fraction);
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
        };
      })
      .filter((o) => o.hasTargets || o.active);

    const ranked = offices
      .filter((o) => o.pct != null)
      .sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0))
      .map((o, i) => ({ ...o, rank: i + 1 }));
    const unranked = offices.filter((o) => o.pct == null).map((o) => ({ ...o, rank: null as number | null }));

    return {
      dataAsOf: ctx.dataAsOf,
      week: {
        nowLabel: ctx.nowLabel,
        start: ctx.windowStart,
        end: ctx.weekDays[4],
        expectedPct: Math.round(ctx.fraction * 100),
        pending: ctx.currentWeekPending,
      },
      offices: [...ranked, ...unranked],
      champion: ranked[0]?.office ?? null,
    };
  });
}

// ---------------------------------------------------------------------------
// Screen 3 — Adviser League
// ---------------------------------------------------------------------------

export async function adviserLeague(config: Config, f: ReportFilters) {
  const asOf = await dataAsOf(config);
  // Window: an explicit range (dashboard toggle) wins; default = the chase month to date.
  const to = f.to ?? asOf;
  const from = f.from ?? monthOf(asOf).from;
  return cached(`ds-adviser-league:${from}:${to}`, ttl(config), async () => {
    const prev = previousPeriod({ from, to });
    const [appsRows, refRows, salesRows, revRows, prevApps, prevRefs] = await Promise.all([
      q<AdviserDailyCount>(config, kpiDailyByAdviser("applications", from, to)),
      q<AdviserDailyCount>(config, kpiDailyByAdviser("referrals", from, to)),
      q<AdviserDailyCount>(config, kpiDailyByAdviser("sales", from, to)),
      q<AdviserRevenue>(config, revenueByAdviser(from, to)),
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
    for (let d = weekOf(from).from; d <= to; d = shiftDays(d, 7)) weekKeys.push(weekOf(d).from);

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
      const wk = weekKeys.indexOf(weekOf(isoDay(r.d)).from);
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

    const revenue = sum(revRows.map((r) => r.revenue ?? 0));
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

    const improved = rows
      .map((r) => {
        const p = prevByName.get(r.name) ?? { apps: 0, refs: 0 };
        const deltaPct = pctDelta(r.apps + r.refs, p.apps + p.refs);
        return { name: r.name, office: r.office, thisApps: r.apps, thisRefs: r.refs, lastApps: p.apps, lastRefs: p.refs, deltaPct };
      })
      .filter((r) => r.thisApps + r.thisRefs >= 3 && r.deltaPct != null && r.deltaPct > 0)
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
  // Operational "as of" for the point-in-time widgets (aged/queues/pipeline): the window end,
  // but never beyond the freshest loaded day.
  const asOf = to < lakeAsOf ? to : lakeAsOf;
  return cached(`ds-funnel-health:${from}:${to}`, ttl(config), async () => {
    const [stagesRows, referralsDaily, salesDaily, aged, queues, pipelineRows, agesRows] = await Promise.all([
      q<funnelQ.MortgageStageCounts>(config, funnelQ.mortgageStageCounts(from, to)),
      q<DailyCount>(config, kpiDaily("referrals", from, to)),
      q<DailyCount>(config, kpiDaily("sales", from, to)),
      q<funnelQ.AgedApplications>(config, funnelQ.agedApplications(asOf)),
      q<funnelQ.ActionQueues>(config, funnelQ.actionQueues(asOf, from)),
      q<funnelQ.PipelineSummary>(config, funnelQ.pipelineSummary(asOf)),
      q<funnelQ.StageAges>(config, funnelQ.stageAges(asOf)),
    ]);

    const s = stagesRows[0] ?? { leads: 0, applications: 0, offers: 0 };
    const referrals = sum(referralsDaily.map((r) => r.n));
    const sales = sum(salesDaily.map((r) => r.n));
    const stages = [
      { key: "leads", label: "Leads", count: s.leads },
      { key: "applications", label: "Mortgage Apps", count: s.applications },
      { key: "offers", label: "Offers", count: s.offers },
      { key: "referrals", label: "Referrals", count: referrals },
      { key: "sales", label: "Protection Sales", count: sales },
    ];
    const conv = (a: number, b: number) => round((divide(b, a) ?? 0) * 100, 0) ?? 0;
    const conversions = stages.slice(0, -1).map((st, i) => ({
      from: st.key,
      to: stages[i + 1].key,
      pct: conv(st.count, stages[i + 1].count),
    }));

    const queueRow = queues[0] ?? { callNow: 0, followUp: 0, chaseLender: 0, writtenLeads: 0 };
    // Flow proxy (no case-level referral join exists in the share): referrals made vs applications
    // written in the same window. The page captions this as indicative.
    const donut = {
      written: queueRow.writtenLeads,
      referred: Math.min(referrals, queueRow.writtenLeads),
      notReferred: Math.max(0, queueRow.writtenLeads - referrals),
    };
    const referNow = Math.max(0, queueRow.writtenLeads - referrals);
    const agedRow = aged[0] ?? { agedCount: 0, avgAgeDays: null, oldestDays: null };
    const pipeline = pipelineRows[0] ?? { inFlightCount: 0, inFlightValue: null, avgCaseSize: null, revenueLatestDay: null };
    const ages = agesRows[0] ?? { leadAvgDays: null, applicationAvgDays: null, offerAvgDays: null };

    const protectionConv = divide(sales, referrals);
    const appToOffer = divide(s.offers, s.applications);
    const alerts: Array<{ severity: "critical" | "warning"; title: string; detail: string }> = [];
    if (protectionConv != null && protectionConv < ALERT_THRESHOLDS.protectionConversionMin) {
      alerts.push({
        severity: "critical",
        title: `Protection Conversion Rate ${Math.round(protectionConv * 100)}%`,
        detail: `${sales} sales from ${referrals} referrals this month — target ${Math.round(ALERT_THRESHOLDS.protectionConversionMin * 100)}%.`,
      });
    }
    if (appToOffer != null && appToOffer < ALERT_THRESHOLDS.appToOfferRateMin) {
      alerts.push({
        severity: "warning",
        title: `Application → Offer Rate ${Math.round(appToOffer * 100)}%`,
        detail: `${s.offers} offers from ${s.applications} applications this month — target ${Math.round(ALERT_THRESHOLDS.appToOfferRateMin * 100)}%.`,
      });
    }
    if (agedRow.agedCount > 0) {
      alerts.push({
        severity: "warning",
        title: `Applications Aged ${ALERT_THRESHOLDS.agedApplicationDays}+ Days in Queue`,
        detail: `${agedRow.agedCount} awaiting a lender offer — avg ${agedRow.avgAgeDays ?? "–"} days, oldest ${agedRow.oldestDays ?? "–"}.`,
      });
    }

    const revenueTarget = REVENUE_DAILY_TARGET;
    const revenueLatest = Math.round(pipeline.revenueLatestDay ?? 0);
    return {
      dataAsOf: asOf,
      window: { from, to: asOf },
      stages,
      conversions,
      stageMetrics: [
        { stage: "Leads", count: s.leads, avgAgeDays: round(ages.leadAvgDays, 0) },
        { stage: "Mortgage Apps", count: s.applications, avgAgeDays: round(ages.applicationAvgDays, 0) },
        { stage: "Offers", count: s.offers, avgAgeDays: round(ages.offerAvgDays, 0) },
        { stage: "Referrals", count: referrals, avgAgeDays: null },
        { stage: "Protection Sales", count: sales, avgAgeDays: null },
      ],
      alerts,
      donut: {
        written: donut.written,
        referred: donut.referred,
        notReferred: donut.notReferred,
        referredPct: round((divide(donut.referred, donut.written) ?? 0) * 100, 0),
      },
      queues: [
        { key: "call-now", label: "Call Now", count: queueRow.callNow, sub: "leads with nothing written yet" },
        { key: "follow-up", label: "Follow Up", count: queueRow.followUp, sub: "offers 7+ days, not completed" },
        { key: "chase-lender", label: "Chase Lender", count: queueRow.chaseLender, sub: `apps ${ALERT_THRESHOLDS.agedApplicationDays}+ days, no offer` },
        { key: "refer-now", label: "Refer Now", count: referNow, sub: "apps not referred to protection" },
      ],
      pipeline: {
        inFlightCount: pipeline.inFlightCount,
        inFlightValue: Math.round(pipeline.inFlightValue ?? 0),
        avgCaseSize: Math.round(pipeline.avgCaseSize ?? 0),
        protectionOpen: donut.notReferred,
        revenueLatestDay: revenueLatest,
        revenueTarget,
        gap: revenueLatest - revenueTarget,
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
  const endWeek = weekOf(asOf);
  const weekStarts: string[] = [];
  if (f.from) {
    for (let w = weekOf(f.from).from; w <= endWeek.from; w = shiftDays(w, 7)) weekStarts.push(w);
  } else {
    for (let i = 12; i >= 0; i--) weekStarts.push(shiftDays(endWeek.from, -7 * i));
  }
  const from = weekStarts[0];
  return cached(`ds-market-momentum:${from}:${asOf}`, ttl(config), async () => {
    const [leads, apps, refs, revenue] = await Promise.all([
      q<DailyCount>(config, kpiDaily("leads", from, asOf)),
      q<DailyCount>(config, kpiDaily("applications", from, asOf)),
      q<DailyCount>(config, kpiDaily("referrals", from, asOf)),
      q<momentumQ.RevenueDaily>(config, momentumQ.revenueDaily(from, asOf)),
    ]);

    const weekIndex = (d: string): number => weekStarts.indexOf(weekOf(d).from);
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
    const revW = weekStarts.map(() => 0);
    const valW = weekStarts.map(() => 0);
    const casesW = weekStarts.map(() => 0);
    for (const r of revenue) {
      const i = weekIndex(isoDay(r.d));
      if (i < 0) continue;
      revW[i] += r.revenue ?? 0;
      valW[i] += r.totalValue ?? 0;
      casesW[i] += r.cases;
    }
    const avgCaseW = casesW.map((n, i) => (n > 0 ? valW[i] / n : null));
    const refRateW = appsW.map((n, i) => (n > 0 ? (refsW[i] / n) * 100 : null));

    const isoWeekNo = (monday: string): number => {
      const dt = new Date(`${monday}T00:00:00Z`);
      const thursday = new Date(dt);
      thursday.setUTCDate(dt.getUTCDate() + 3);
      const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
      return Math.ceil(((thursday.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
    };
    const weeks = weekStarts.map((w) => `W${isoWeekNo(w)}`);

    // The chase week (last bucket) is usually partial — deltas compare the last COMPLETE week
    // against the one before; charts still show the partial week (its label carries a caveat).
    const partialLast = weekOf(asOf).to > asOf;
    const li = partialLast ? weekStarts.length - 2 : weekStarts.length - 1;
    const quarterAvg = (xs: Array<number | null>): number | null => {
      const usable = xs.slice(0, li + 1).filter((x): x is number => x != null);
      return usable.length ? sum(usable) / usable.length : null;
    };
    const kpi = (key: string, label: string, series: Array<number | null>, fmt: "int" | "gbp" | "gbpk") => {
      const latest = series[li] ?? null;
      const prior = series[li - 1] ?? null;
      const qa = quarterAvg(series);
      return {
        key,
        label,
        fmt,
        latest,
        weekLabel: weeks[li],
        delta: latest != null && prior != null ? round(latest - prior, 1) : null,
        deltaPct: latest != null && prior != null ? pctDelta(latest, prior) : null,
        vsQuarterPct: latest != null && qa ? round(((latest - qa) / qa) * 100, 1) : null,
      };
    };

    const kpis = [
      kpi("applications", "Mortgage Applications", appsW, "int"),
      kpi("referrals", "Protection Referrals", refsW, "int"),
      kpi("revenue", "Weekly Revenue", revW, "gbpk"),
      kpi("leads", "Lead Volume", leadsW, "int"),
      kpi("case-size", "Avg Case Size", avgCaseW, "gbpk"),
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

    return {
      dataAsOf: asOf,
      weeks,
      partialLastWeek: partialLast,
      series: {
        applications: appsW,
        referrals: refsW,
        revenueK: revW.map((v) => round(v / 1000, 1)),
        leads: leadsW,
        avgCaseSizeK: avgCaseW.map((v) => (v == null ? null : round(v / 1000, 0))),
        referralRatePct: refRateW.map((v) => (v == null ? null : round(v, 1))),
      },
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
    // lake is a nightly build, so this is honestly "latest activity", not live-now.
    const asOf = core.ctx.latestWorkingDay;
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
    for (const k of KPI_KEYS) {
      const weekly = DAILY_TARGETS[k] * 5;
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
    const officePaces = officeAggregates(core)
      .map((o) => ({ office: o.office, pct: pctToPace(o.mtd, OFFICE_DAILY_TARGETS[o.office] ?? emptyKpiRecord(), core.ctx) }))
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
// Registry
// ---------------------------------------------------------------------------

export const DATASETS = {
  meta: (config: Config) => meta(config),
  "daily-run-chase": dailyRunChase,
  "office-run-chase": officeRunChase,
  "adviser-league": adviserLeague,
  "funnel-health": funnelHealth,
  "market-momentum": marketMomentum,
  "live-feed": liveFeed,
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
