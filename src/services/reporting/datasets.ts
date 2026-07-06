// Dataset facade — the single source both route prefixes (/api/reporting/* behind Easy Auth,
// /api/kiosk token-gated) resolve through. One composite payload per screen; a short server-side
// TTL cache means N wall TVs cost ~one Fabric query set per dataset per TTL.
//
// Chase model (v1): the lake is day-grained and rebuilt nightly, so the run chase is MONTH-TO-DATE
// vs monthly targets (daily target × working days), measured through the latest complete day in the
// lake ("data as of"). The pacing seam (pacing.ts) is the single plug-point for a future intraday
// or drip feed.

import type { Config } from "../../config.js";
import { OFFICES, UNASSIGNED, officeOf } from "../../domain/offices.js";
import {
  ALERT_THRESHOLDS,
  DAILY_TARGETS,
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
import { chaseStatus, computePace, type ChaseStatus, type Pace } from "./pace.js";
import { mtdPacing, type PacingContext } from "./pacing.js";
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
  ctx: PacingContext;
  /** Business-wide daily counts per KPI across the chase month. */
  daily: Record<KpiKey, DailyCount[]>;
  /** Daily counts per adviser per KPI across the chase month. */
  byAdviser: Record<KpiKey, AdviserDailyCount[]>;
}

async function chaseCore(config: Config): Promise<ChaseCore> {
  return cached("chase-core", ttl(config), async () => {
    const asOf = await dataAsOf(config);
    const ctx = mtdPacing(asOf);
    const [daily, byAdviser] = await Promise.all([
      loadPerKpi(config, (k) => kpiDaily(k, ctx.monthStart, ctx.dataAsOf)),
      loadPerKpi(config, (k) => kpiDailyByAdviser(k, ctx.monthStart, ctx.dataAsOf)),
    ]);
    return { ctx, daily: daily as Record<KpiKey, DailyCount[]>, byAdviser: byAdviser as Record<KpiKey, AdviserDailyCount[]> };
  });
}

async function loadPerKpi<T>(config: Config, build: (k: KpiKey) => BuiltQuery): Promise<Record<KpiKey, T[]>> {
  const rows = await Promise.all(KPI_KEYS.map((k) => q<T>(config, build(k))));
  return Object.fromEntries(KPI_KEYS.map((k, i) => [k, rows[i]])) as Record<KpiKey, T[]>;
}

const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

/** Working days of the chase month (labels for pace-chart x-axes). */
function chaseDays(ctx: PacingContext): string[] {
  const days: string[] = [];
  for (let d = ctx.monthStart; d <= ctx.monthEnd; d = shiftDays(d, 1)) {
    const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (dow !== 0 && dow !== 6) days.push(d);
  }
  return days;
}

/** Cumulative counts aligned to `days` — weekend activity folds into the next working day;
 *  null after the data-as-of day (the line stops at the present). */
function cumulativeSeries(daily: DailyCount[], days: string[], asOf: string): Array<number | null> {
  const byDay = new Map(daily.map((r) => [isoDay(r.d), r.n]));
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

/** Straight target pace across the month's working days. */
function targetPaceSeries(monthlyTarget: number, count: number): number[] {
  return Array.from({ length: count }, (_, i) => Math.round((monthlyTarget * (i + 1)) / count));
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
  /** Cumulative-by-working-day per KPI (aligned to chaseDays). */
  series: Record<KpiKey, Array<number | null>>;
}

function emptyKpiRecord(): KpiTargets {
  return { leads: 0, applications: 0, referrals: 0, sales: 0 };
}

function officeAggregates(core: ChaseCore): OfficeCums[] {
  const days = chaseDays(core.ctx);
  const officeList = [...OFFICES.map((o) => ({ name: o.name, color: o.color })), { name: UNASSIGNED, color: "#64748B" }];
  return officeList.map(({ name, color }) => {
    const mtd = emptyKpiRecord();
    const latest = emptyKpiRecord();
    const series = {} as Record<KpiKey, Array<number | null>>;
    for (const k of KPI_KEYS) {
      const mine = core.byAdviser[k].filter((r) => officeOf(r.username) === name);
      const dailyMine: DailyCount[] = mine.map((r) => ({ d: r.d, n: r.n }));
      mtd[k] = sum(mine.map((r) => r.n));
      latest[k] = sum(mine.filter((r) => isoDay(r.d) === core.ctx.dataAsOf).map((r) => r.n));
      series[k] = cumulativeSeries(dailyMine, days, core.ctx.dataAsOf);
    }
    return { office: name, color, mtd, latest, series };
  });
}

/** % of expected-by-now pace, averaged across the four KPIs (equal weights). Null when no targets. */
function pctToPace(mtd: KpiTargets, targets: KpiTargets, ctx: PacingContext): number | null {
  const ratios: number[] = [];
  for (const k of KPI_KEYS) {
    const monthly = targets[k] * ctx.workingDaysTotal;
    const expected = monthly * ctx.fraction;
    if (expected > 0) ratios.push(mtd[k] / expected);
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
  return {
    offices: [...OFFICES],
    targets: {
      daily: DAILY_TARGETS,
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
    const days = chaseDays(ctx);

    const kpis = KPI_KEYS.map((k) => {
      const monthlyTarget = DAILY_TARGETS[k] * ctx.workingDaysTotal;
      const mtd = sum(core.daily[k].map((r) => r.n));
      const latestDay = dayTotal(core.daily[k], ctx.dataAsOf);
      const pace: Pace = computePace(monthlyTarget, mtd, ctx.fraction);
      const actual = cumulativeSeries(core.daily[k], days, ctx.dataAsOf);
      return {
        key: k,
        label: KPI_LABELS[k],
        dailyTarget: DAILY_TARGETS[k],
        monthlyTarget,
        mtd,
        latestDay,
        pace,
        chart: {
          days,
          actual,
          targetPace: targetPaceSeries(monthlyTarget, days.length),
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
      month: {
        start: ctx.monthStart,
        end: ctx.monthEnd,
        workingDaysElapsed: ctx.workingDaysElapsed,
        workingDaysTotal: ctx.workingDaysTotal,
        fraction: round(ctx.fraction, 3),
        nowLabel: ctx.nowLabel,
      },
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
    const days = chaseDays(ctx);
    const paceLine = Array.from({ length: days.length }, (_, i) => Math.round(((i + 1) / days.length) * 100));

    const offices = officeAggregates(core)
      .map((o) => {
        const targets = OFFICE_DAILY_TARGETS[o.office] ?? emptyKpiRecord();
        const hasTargets = KPI_KEYS.some((k) => targets[k] > 0);
        const kpis = KPI_KEYS.map((k) => {
          const monthlyTarget = targets[k] * ctx.workingDaysTotal;
          const pace = computePace(monthlyTarget, o.mtd[k], ctx.fraction);
          return {
            key: k,
            label: KPI_LABELS[k],
            actual: o.mtd[k],
            target: monthlyTarget,
            expected: pace.expectedByNow,
            gap: pace.aheadBehind,
            status: chaseStatus(o.mtd[k], pace.expectedByNow),
          };
        });
        // Mini chart: blended % of monthly target achieved by day vs the straight pace line.
        const pctSeries = days.map((_, i) => {
          const ratios: number[] = [];
          for (const k of KPI_KEYS) {
            const monthly = targets[k] * ctx.workingDaysTotal;
            const v = o.series[k][i];
            if (monthly > 0 && v != null) ratios.push(v / monthly);
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
      month: { nowLabel: ctx.nowLabel, workingDaysElapsed: ctx.workingDaysElapsed, workingDaysTotal: ctx.workingDaysTotal },
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

export async function funnelHealth(config: Config, _f: ReportFilters) {
  return cached("ds-funnel-health", ttl(config), async () => {
    const asOf = await dataAsOf(config);
    const ctx = mtdPacing(asOf);
    const [stagesRows, referralsDaily, salesDaily, aged, queues, pipelineRows, agesRows] = await Promise.all([
      q<funnelQ.MortgageStageCounts>(config, funnelQ.mortgageStageCounts(ctx.monthStart, asOf)),
      q<DailyCount>(config, kpiDaily("referrals", ctx.monthStart, asOf)),
      q<DailyCount>(config, kpiDaily("sales", ctx.monthStart, asOf)),
      q<funnelQ.AgedApplications>(config, funnelQ.agedApplications(asOf)),
      q<funnelQ.ActionQueues>(config, funnelQ.actionQueues(asOf, ctx.monthStart)),
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
      window: { from: ctx.monthStart, to: asOf },
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

export async function marketMomentum(config: Config, _f: ReportFilters) {
  return cached("ds-market-momentum", ttl(config), async () => {
    const asOf = await dataAsOf(config);
    // 13 full ISO weeks ending with the week containing dataAsOf.
    const thisWeek = weekOf(asOf);
    const weekStarts: string[] = [];
    for (let i = 12; i >= 0; i--) weekStarts.push(shiftDays(thisWeek.from, -7 * i));
    const from = weekStarts[0];

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
    const asOf = core.ctx.dataAsOf;
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

    // Milestones from the chase state — the "story of the day" lines between events.
    const milestones: Item[] = [];
    for (const k of KPI_KEYS) {
      const monthlyTarget = DAILY_TARGETS[k] * core.ctx.workingDaysTotal;
      const mtd = sum(core.daily[k].map((r) => r.n));
      const pace = computePace(monthlyTarget, mtd, core.ctx.fraction);
      if (pace.status !== "on_pace") {
        milestones.push({
          kind: "milestone",
          icon: pace.status === "ahead" ? "📈" : "📉",
          text: `${KPI_LABELS[k]}: ${Math.abs(pace.aheadBehind)} ${pace.status === "ahead" ? "ahead of" : "behind"} monthly pace`,
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
