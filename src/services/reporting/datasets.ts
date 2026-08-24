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
  dayRecordedShare,
  INPUT_LAG_SETTLE_DAYS,
  MORTGAGE_WRITTEN_DATE,
  PROTECTION_WRITTEN_DATE,
  PROTECTION_WRITTEN_STATUSES,
} from "../../domain/data-quality.js";
import { ORGANISATIONS } from "../../domain/firm.js";
import { DATA_CADENCE, METRIC_DEFINITIONS } from "../../domain/metrics.js";
import { OFFICES, UNASSIGNED, isSharedAccount, officeOf, officeOrderIndex } from "../../domain/offices.js";
import { needsExplaining, settleThrough } from "../snapshots/history.js";
import { closedWeekStarts, loadRevisions, observeWeeks } from "../snapshots/recorder.js";
import {
  dayTarget,
  KPI_KEYS,
  KPI_LABELS,
  LEAGUE,
  REFERRAL_RATE_TARGET,
  TARGETED_KPI_KEYS,
  WEEK_DAY_NAMES,
  type KpiKey,
  type KpiTargets,
} from "../../domain/targets.js";
import { cached } from "./cache.js";
import { EMPTY_FILTERS, type ReportFilters } from "./filters.js";
import * as funnelQ from "./funnel.js";
import { kpiDaily, kpiDailyByAdviser, type AdviserDailyCount, type DailyCount } from "./kpis.js";
import * as momentumQ from "./momentum.js";
import { chaseStatus, computePace, tzHour, tzToday, type ChaseStatus, type Pace } from "./pace.js";
import { completeThrough, isTradingDay, isWeekendOnlyWeek, weekDayIndex, weekElapsedFraction, weeklyPacing, type WeeklyPacingContext } from "./pacing.js";
import { run, type BuiltQuery } from "./query.js";
// `protectionCommissionByAdviser` is deliberately NOT imported any more: it credits a policy's whole
// commission to its primary adviser, which is the 100%-to-the-protection-adviser behaviour the 60/40
// replaced. It survives in advisers.ts with its tests because it is the right query for "who wrote
// this protection", which is a different question from "who earned it".
import { revenueByAdviser, type AdviserRevenue } from "./advisers.js";
import { referredProtectionSales, type ReferredSale } from "./referrals.js";
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
 *  times a day. Surfaced so the header can state the truth instead of a cadence nobody had checked.
 *
 *  THE TIMES, IN LONDON, measured off the distinct load stamps for 1–21 Aug 2026 (n≈85):
 *
 *    08:21–09:07   11:58–12:51   14:53–15:33   17:51–18:29   20:49–21:22
 *
 *  Stated as UTC here until 2026-08-21 ("~07:50 / 11:10 / …"), which was correct — and useless, because
 *  the user-facing copy in domain/metrics.ts repeated those numbers with no timezone on them while every
 *  other clock on the board is Europe/London. Through BST that reads an hour early, so Kyle looked at
 *  11:21 expecting the 11:10 load to have landed when the real second load of the day arrives closer to
 *  12:20 (2026-08-21). The copy now gives London times and says the times drift.
 *
 *  They do drift, and loads are occasionally MISSED: 20 Aug ran four loads, not five, and 21 Aug opened
 *  with a one-off 06:21 outside every normal window. So the header's job is not to promise a schedule —
 *  it is to stamp the load actually being displayed. */
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
  /**
   * Share of a day's business the ETL has typically COPIED by this load (0–1) — see dayRecordedShare.
   *
   * What makes today judgeable. Multiply a day's target by this and you get what should be on the
   * board right now, as opposed to what should have happened by close of play. At the morning load
   * that is 1.5% of the day, which is why comparing today's raw count with a whole day's target reads
   * as a collapse every morning. Null when there is no load stamp to place on the curve.
   */
  recordedShare: number | null;
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
    const recordedShare = dayRecordedShare(
      loadedAt ? tzHour(new Date(loadedAt), config.reporting.timeZone) : null,
    );
    return { date: today, loadedAt, counts, recordedShare };
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
  return { leads: 0, applications: 0, referrals: 0, sales: 0, existingCases: 0 };
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

    // The Total Lending tile was removed from this screen on Capricorn's instruction (2026-08-17), so
    // the loan-value query that fed it is gone with it rather than left running for nobody. Lending
    // is still reported: Momentum carries "Weekly Written" (commission) and Avg Case Size (loan
    // value), and the League carries Est. Revenue. Restoring the tile means restoring
    // `momentumQ.revenueDaily` over `ctx.windowStart → ctx.dataAsOf` and summing `totalValue`.
    const today = await todaySoFar(config);

    const dailyTargets = getDailyTargets();
    const kpis = KPI_KEYS.map((k) => {
      const weekly = dailyTargets[k] * 5;
      // A KPI Capricorn have set no target for is TRACKED, not chased. Without this it would pace
      // against zero, and paceStatus/chaseStatus read "expected 0, actual > 0" as ahead — so
      // `existingCases` would sit on the wall permanently bright green for beating a target that does
      // not exist. The flag lets the card render the figure and its trend with no verdict attached.
      const targeted = weekly > 0;
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
        /** False = tracked but not chased; the card shows no target, gap, pace or status. */
        targeted,
        weeklyTarget: weekly,
        wtd,
        // Week pace — drives the trend chart's header status (the chart is the WTD trend).
        pace: targeted ? pace : null,
        day: {
          date: ctx.latestDay,
          actual: dayActual,
          target: targeted ? target : null,
          gap: targeted ? dayActual - target : null,
          status: targeted ? chaseStatus(dayActual, target) : null,
        },
        weekProgress: {
          actualPct,
          // Percentages OF THE WEEKLY TARGET — meaningless without one, so both go null together
          // rather than showing an expected-% line the actual can never be measured against.
          expectedPct: targeted ? expectedPct : null,
          // +ahead / −behind, percentage points of the weekly target.
          gapPp: actualPct != null && targeted && expectedPct != null ? round(actualPct - expectedPct, 1) : null,
        },
        chart: {
          days,
          actual,
          // No target line and no projection for an untargeted KPI: a flat zero pace line would read
          // as a target of nothing, and a projection only means something against one.
          targetPace: targeted ? weeklyTargetPace(weekly, ctx.cumulativeShares[k]) : null,
          projection: targeted ? projectionSeries(actual, pace.projectedFinish) : null,
        },
      };
    });

    // The strip's "expected so far" is, by construction, the blended cumulative share at dataAsOf —
    // i.e. exactly the label printed under the last filled day. On its own it therefore told you
    // nothing the strip had not already said, which is what Capricorn spotted on 2026-08-18 ("we say
    // expected and we show progress but they always seem to match"). Pairing it with the blended
    // ACTUAL attainment gives the two numbers something to disagree about. Blended the same way the
    // expected curve is (a mean across the TARGETED KPIs, see BLENDED_CUMULATIVE_SHARES) so both
    // halves of the comparison are built alike; each KPI's own figure is on its own card.
    const judgedKpis = kpis.filter((k) => k.targeted && k.weekProgress.actualPct != null);
    const blendedActualPct = judgedKpis.length
      ? round(judgedKpis.reduce((a, k) => a + (k.weekProgress.actualPct ?? 0), 0) / judgedKpis.length, 1)
      : null;

    // The Office Leaderboard was removed from this screen on 2026-08-19 (Capricorn), and with it the
    // per-office `leaderboard` / `leaderboardTotals` this dataset used to carry. Nothing rendered them
    // afterwards, and a payload field no page reads is the kind of thing that gets "fixed" later by
    // someone who assumes it is live. Office-level chase is officeRunChase's entire job — including
    // the per-KPI against-target read, which it shows for every office rather than one table's worth.
    return {
      dataAsOf: ctx.dataAsOf,
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
        /** Blended ACTUAL attainment across the targeted KPIs, so "expected so far" has something to
         *  be compared against rather than restating the strip. Null before any targeted KPI has a
         *  measurable week. */
        actualPct: blendedActualPct,
        /** +ahead / −behind, percentage points of the weekly target, blended. */
        gapPp: blendedActualPct != null ? round(blendedActualPct - ctx.fraction * 100, 1) : null,
        nowLabel: ctx.nowLabel,
        latestDay: ctx.latestDay,
        pending: ctx.currentWeekPending,
      },
      dataAsOfLagsWeek: ctx.currentWeekPending,
      kpis,
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
        const hasTargets = TARGETED_KPI_KEYS.some((k) => targets[k] > 0);
        // TARGETED KPIs only. This screen exists to rank offices against their targets, and its tiles
        // are "actual/target" with a pace bar — an untargeted KPI has no honest rendering here (and
        // chaseStatus would band "expected 0, actual > 0" as ahead, painting it green). The
        // untargeted measures live on the Daily Run Chase cards instead.
        const kpis = TARGETED_KPI_KEYS.map((k) => {
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
          for (const k of TARGETED_KPI_KEYS) {
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
  // ONE WINDOW FOR THE WHOLE SCREEN — the rolling 4 weeks the leaderboards rank over.
  //
  // The strip used to report the current week while the boards below ranked over four, on the
  // reasoning that the strip stayed comparable with the run-chase screens. In the room that just
  // produced two date ranges on one page, which is the "screens disagree" reading this whole
  // engagement has been about. Luke, 2026-08-19: "make their date range match the date range of the
  // three columns underneath. We will go on a four-week rolling period so that everything matches."
  //
  // `boardWindowFrom` is the single source, so the strip and the boards cannot drift apart.
  //
  // ⚠ Consequence, accepted: these totals are NO LONGER a week and will not tie to a weekly Total
  // Written Report. The window is printed on every tile; Market Momentum remains the week-on-week
  // screen.
  const to = f.to ?? (asOf < today ? asOf : today);
  const from = f.from ?? boardWindowFrom(to);
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
    // CLIENT FEES ARE NOT PART OF THIS TOTAL. Kyle, 2026-08-10: "Please can we completely separate
    // the Client Fee – as our written report does not capture the client fee." Until now the tile
    // read commission + fees, which is a wider measure than anything Capricorn reports and therefore
    // could never tie to their Total Written Report — it guaranteed a gap on every comparison. Fees
    // are still carried and still shown, as their own figure beside the total, because they are real
    // income and the 37%-of-cases-with-no-fee finding depends on them being visible. They are simply
    // no longer added in.
    const revenue = commission;
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

    const boards = await leagueBoards(config, to);

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
      boards,
    };
  });
}

// ---------------------------------------------------------------------------
// Screen 3b — the three cross-ranked leaderboards
// ---------------------------------------------------------------------------

/** How many weeks the boards rank over. A SINGLE week cannot carry a ranking: in the last complete
 *  week the top scorer wrote 14 and six advisers wrote exactly 1, so places 5th downward are decided
 *  by a single case and would reshuffle randomly every week. Over four weeks the top scorer is 44,
 *  which separates people on behaviour rather than noise. */
const BOARD_WEEKS = 4;

/** Rows shown per board. Ten across all three so the columns are the same height and row N lines up
 *  with row N beside it — the connecting lines are drawn between rows, so a ragged right-hand column
 *  makes them read as though they point at the wrong person. The protection team is only ~6 people,
 *  so that board still shows everyone. */
const BOARD_ROWS = 10;

interface BoardRow {
  rank: number;
  name: string;
  office: string;
  /** The headline count for THIS board. */
  value: number;
  /** Mortgages written in the board window (0 for protection-only advisers). */
  written: number;
  /** Protection sales introduced by this adviser's clients. */
  referred: number;
  /** Protection sales this adviser wrote themselves. */
  sold: number;
  /** referred ÷ written, as a percentage. Null when they wrote nothing. */
  rate: number | null;
  /** Protection commission, £ — only meaningful on the converters' board. */
  commission: number;
  /** Who converted this adviser's referrals (originators), busiest first. */
  partners: Array<{ name: string; n: number }>;
}

/**
 * Mortgages written, protection referred, and protection sold — three boards over the same window.
 *
 * The three do NOT rank the same population, which is the whole reason this is built the way it is.
 * Protection sales are written by a specialist team of about six people who write no mortgages at
 * all, so a mortgage adviser being absent from that board is their job description, not a failure.
 * The link between the two populations is the REFERRED board: a protection sale is credited both to
 * the adviser who wrote it and to the mortgage adviser whose client it was.
 *
 * `referred` replaced "protection opportunities opened" after the data contradicted it. James Storer
 * opened 1 opportunity against 36 mortgages written, which looked like a total failure to cross-sell
 * — but his clients produced 6 protection sales worth £10,787. Opportunities-opened measures who does
 * the data entry; referred measures who introduces the business. See services/reporting/referrals.ts
 * for how the credit is derived, and its caveats.
 */
/** Conversion rate as the ROUNDED percentage the row prints. Tie-breaking on the unrounded ratio
 *  would hand two rows both showing "21% converted" different ranks — the same "these numbers are
 *  arguing with each other" failure as the shared ranks it replaces, just harder to spot. */
function conversionPct(a: { written: number; referred: number }): number {
  return a.written > 0 ? Math.round((a.referred / a.written) * 100) : 0;
}

/**
 * Competition ranking on `pick` — zeroes excluded, biggest first, capped at `limit`.
 *
 * `tie` both ORDERS level rows and SEPARATES their ranks. Capricorn asked for the Protection Referred
 * board to settle its ties on conversion percentage rather than printing three sixth places
 * (2026-08-19): three advisers on 3 referrals each is a tie on the count, but 100%, 21% and 8% of
 * their own clients is not a tie on anything that matters. Pass `() => 0` and a board keeps the plain
 * competition ranking (1,2,2,4) — which is what Mortgages Written and Protection Sales still do,
 * because two advisers who each wrote 24 have nothing to be separated on.
 *
 * A rank is still SHARED when two rows are level on the measure AND on the tie-break. There is
 * nothing left to tell them apart with, and inventing an order would be a ranking the data cannot
 * support. `written` is the final comparator only: it fixes the display order inside a shared rank
 * without ever splitting one, which is why it is not folded into `tie`.
 */
export function rankBoard<T extends { written: number }>(
  rows: readonly T[],
  pick: (a: T) => number,
  tie: (a: T) => number,
  limit: number,
): Array<{ row: T; rank: number }> {
  const sorted = rows
    .filter((a) => pick(a) > 0)
    .slice()
    .sort((x, y) => pick(y) - pick(x) || tie(y) - tie(x) || y.written - x.written);
  let prevValue = Number.NaN;
  let prevTie = Number.NaN;
  let rank = 0;
  return sorted.slice(0, limit).map((row, i) => {
    if (pick(row) !== prevValue || tie(row) !== prevTie) {
      rank = i + 1;
      prevValue = pick(row);
      prevTie = tie(row);
    }
    return { row, rank };
  });
}

/** Start of the rolling board window ending at `to`. Exported-by-use: `adviserLeague` calls it for
 *  its own default window so the strip above the boards covers exactly the same days. */
function boardWindowFrom(to: string): string {
  return shiftDays(weekStartOf(to), -7 * (BOARD_WEEKS - 1));
}

export async function leagueBoards(config: Config, to: string) {
  const from = boardWindowFrom(to);
  return cached(`ds-league-boards:${from}:${to}`, ttl(config), async () => {
    const [writtenRows, soldRows, referralRows] = await Promise.all([
      q<AdviserDailyCount>(config, kpiDailyByAdviser("applications", from, to)),
      q<AdviserDailyCount>(config, kpiDailyByAdviser("sales", from, to)),
      q<ReferredSale>(config, referredProtectionSales(from, to)),
    ]);

    interface Acc {
      name: string; username: string | null; written: number; referred: number; sold: number;
      commission: number; partners: Map<string, number>;
    }
    const people = new Map<string, Acc>();
    const nameOf = (username: string | null, full: string | null) => full?.trim() || username?.trim() || "Unknown";
    const get = (username: string | null, full: string | null): Acc => {
      const name = nameOf(username, full);
      let a = people.get(name);
      if (!a) {
        a = { name, username, written: 0, referred: 0, sold: 0, commission: 0, partners: new Map() };
        people.set(name, a);
      }
      return a;
    };

    for (const r of writtenRows) get(r.username, r.fullName).written += r.n;
    for (const r of soldRows) get(r.username, r.fullName).sold += r.n;

    // Referral credit. Self-referrals (the protection adviser sourced the client themselves) are
    // dropped: crediting someone for introducing business to themselves would flatter the board and
    // tell nobody anything.
    let attributed = 0;
    let unattributed = 0;
    for (const r of referralRows) {
      if (!r.originator) { unattributed += r.sales; continue; }
      if (r.originator === r.converter) continue;
      attributed += r.sales;
      const o = get(r.originator, r.originatorName);
      o.referred += r.sales;
      const who = nameOf(r.converter, r.converterName);
      o.partners.set(who, (o.partners.get(who) ?? 0) + r.sales);
      // The converter keeps their own commission total; the originator's referred count is separate.
      get(r.converter, r.converterName).commission += r.commission ?? 0;
    }
    for (const r of referralRows) {
      if (r.originator && r.originator === r.converter) {
        get(r.converter, r.converterName).commission += r.commission ?? 0;
      }
    }

    const all = [...people.values()];
    const board = (pick: (a: Acc) => number, limit: number, tie: (a: Acc) => number = () => 0): BoardRow[] =>
      rankBoard(all, pick, tie, limit).map(({ row: a, rank }) => {
        return {
          rank,
          name: a.name,
          office: officeOf(a.username),
          value: pick(a),
          written: a.written,
          referred: a.referred,
          sold: a.sold,
          rate: a.written > 0 ? conversionPct(a) : null,
          commission: Math.round(a.commission),
          partners: [...a.partners.entries()].map(([n, v]) => ({ name: n, n: v })).sort((p, r2) => r2.n - p.n),
        };
      });

    return {
      window: { from, to, weeks: BOARD_WEEKS },
      /** Honest coverage for the referred board — shown on screen, not hidden. */
      attribution: { attributed, unattributed, pct: round(divide(attributed, attributed + unattributed), 3) },
      written: board((a) => a.written, BOARD_ROWS),
      // The only board with a quality measure to settle its ties with, so the only one that does.
      referred: board((a) => a.referred, BOARD_ROWS, conversionPct),
      sold: board((a) => a.sold, BOARD_ROWS),
    };
  });
}

// ---------------------------------------------------------------------------
// Screen 4 — Funnel Health
// ---------------------------------------------------------------------------

export async function funnelHealth(config: Config, f: ReportFilters) {
  const lakeAsOf = await dataAsOf(config);
  // Window: an explicit date range (dashboard filter) wins; else the CURRENT WEEK — the same Sat–Fri
  // week the run-chase and Momentum screens use.
  //
  // This was month-to-date until 2026-08-11, which is defensible on the merits (offers arrive weeks
  // after the business is written, so a one-week funnel understates the offer stage) but it put 722
  // leads next to Momentum's 43 and read as broken data. Kyle, having had it explained: "I was not
  // aware that this was showing MTD … this is meant to be driving daily and weekly action. My gut
  // feel is that this should be more aligned with the other screens." He is the customer and the
  // screen is for weekly action, so it moves to the week. The offer-lag caveat is now stated on the
  // screen instead of being silently designed around — the Offers stage will read low early in a
  // week and that is a real property of the business, not a measurement artefact.
  const from = f.from ?? weekStartOf(tzToday(new Date(), config.reporting.timeZone));
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

    const s = stagesRows[0] ?? { leads: 0, existingCases: 0, applications: 0, offers: 0 };
    const referrals = sum(referralsDaily.map((r) => r.n));
    const sales = sum(salesDaily.map((r) => r.n));
    const stages = [
      // The mouth of the funnel is NEW CLIENTS, same definition as the run chase (Capricorn
      // 2026-08-17). Existing-client cases are NOT a funnel stage — they enter the pipeline further
      // along and would inflate every conversion denominator below — so they ride alongside as
      // context, see `existingCases` in the payload.
      { key: "leads", label: "New Client Leads", count: s.leads },
      { key: "applications", label: "Mortgages Written", count: s.applications },
      { key: "offers", label: "Offers", count: s.offers },
      { key: "referrals", label: "Protection Referrals", count: referrals },
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
      /** Cases opened for clients already on the books in the same window — remortgages above all.
       *  Deliberately OUTSIDE `stages`: it is not a funnel stage (it enters part-way along, and
       *  folding it into the leads stage would inflate every conversion denominator), but the page
       *  shows it next to the funnel so the pipeline story isn't missing the remortgage book. */
      existingCases: s.existingCases,
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
  // THE HEADLINE WEEK, computed BEFORE the fetch because the commission league is queried for exactly
  // this window. Reference the last week that has genuinely ENDED (its Saturday start is before THIS
  // reporting week) AND is fully data-loaded (Friday <= dataAsOf) — not the last bucket, which is
  // usually mid-week: treating an in-progress week as complete understates the actual against a
  // full-week target (~23% of a week-in-progress vs the true ~45%). Doing it here is what makes the
  // graph's last actual point and the league's rows the SAME week by construction rather than by
  // coincidence — the two halves of this screen now have to add up to each other.
  const currentWeekStart = weekStartOf(tzToday(new Date(), config.reporting.timeZone));
  let completeIdx = 0;
  for (let i = weekStarts.length - 1; i >= 0; i--) {
    if (weekStarts[i] < currentWeekStart && shiftDays(weekStarts[i], 6) <= asOf) { completeIdx = i; break; }
  }
  // THE SUBJECT WEEK — what the two panels are ABOUT. The current one, to date.
  //
  // It was `completeIdx`, the last week that had both ended and fully loaded, and Capricorn read that
  // as the page being stale: "it looks like the market momentum page is basing off week 33 rather than
  // the current week of 34" (2026-08-20). They are right that it was, and right that it should not be:
  // every other screen reports the current week, and Kyle asked for this page to as well — "Don't we
  // want to compare current week to prior week? I'd have current week i.e. WK32 compared to WK31 and
  // show the difference" (2026-08-07). The KPI tiles were changed then and have led with the current
  // week ever since; the two panels that survived the 2026-08-19 cut simply never followed, so the
  // page has been showing a current-week payload through last-week panels.
  //
  // The reason it was `completeIdx` is real and is NOT solved by ignoring it: a part-week's written
  // commission measured against a whole-week target reads as a collapse, and input lag makes that
  // worse (mean ~6 days, so Wednesday's figure is still arriving on Monday). So the subject moves to
  // the current week and the COMPARISONS change with it — the prior week truncated to the same
  // weekday, and a full-week forecast for the one number a full-week target can fairly judge. No
  // "% of target" is printed against a part week at all.
  //
  // THE WEEKEND GUARD IS GONE, because the thing it guarded against has been fixed properly.
  //
  // It sent the subject back to the last complete week whenever the current one held only weekend
  // days — Saturday, Sunday and Monday, three days in seven — because leading with a weekend read as
  // a 93% collapse (Kyle, 2026-08-10). But that collapse was an artefact of comparing a part week
  // against a WHOLE one. Since 2026-08-20 this page does not do that: the week to date is set against
  // the prior week's same days, and the target percentage hangs off the forecast, never off the
  // part-week actual. Two weekend days against two weekend days is a fair comparison.
  //
  // Leaving the guard in place had a cost Kyle then hit twice: he asked for the current week on
  // 2026-08-20 and again on 2026-08-21 ("This is meant to be for the current week and a run rate to
  // target for the week"), and on the Monday morning of the announcement the page was showing W34
  // again. A guard that makes the page look a week stale on the day it is presented is worse than the
  // thing it was guarding against.
  //
  // Safe because the forecast is not a scale-up. It is actual-so-far PLUS each remaining weekday's own
  // trailing average (see `writtenForecastTotal`), so from two weekend days it still produces a
  // sensible full-week estimate rather than multiplying a weekend by three and a half.
  const subjectIdx = weekStarts.length - 1;
  const subjectEnd = shiftDays(weekStarts[subjectIdx], 6);
  // One window for both halves of the screen, as before: the graph's headline figure and the league's
  // rows cannot land on different dates because they are the same object.
  const leagueWindow = { from: weekStarts[subjectIdx], to: subjectEnd < asOf ? subjectEnd : asOf };
  return cached(`ds-market-momentum:${from}:${asOf}`, ttl(config), async () => {
    const [leads, apps, refs, revenue, protWritten, mortByAdviser, protReferred] = await Promise.all([
      q<DailyCount>(config, kpiDaily("leads", from, asOf)),
      q<DailyCount>(config, kpiDaily("applications", from, asOf)),
      q<DailyCount>(config, kpiDaily("referrals", from, asOf)),
      q<momentumQ.RevenueDaily>(config, momentumQ.revenueDaily(from, asOf)),
      q<momentumQ.ProtectionWrittenDaily>(config, momentumQ.protectionWrittenDaily(from, asOf)),
      q<AdviserRevenue>(config, revenueByAdviser(leagueWindow.from, leagueWindow.to)),
      // Protection comes through the REFERRAL query rather than protectionCommissionByAdviser, because
      // the league now applies Capricorn's 60/40 and that needs both ends of each policy: who wrote it
      // and whose client it was. Same window, same statuses, same population — see `splitProtection`.
      q<ReferredSale>(config, referredProtectionSales(leagueWindow.from, leagueWindow.to)),
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
    // …BUT NOT WHEN THE "CURRENT WEEK" IS ONLY A WEEKEND.
    //
    // Kyle, 2026-08-10: "I don't think this is refreshing 5 times a day as the below figures are
    // completely off? Appears this has gotten worse?" The board was showing W33 to Sun 9 Aug — one
    // mortgage written, 43 leads, £1.4k — against W32's same two days, and reporting −92.9%. Every
    // figure was correct. The problem is that the reporting week starts on Saturday and `dataAsOf`
    // is the last COMPLETE day, so from Saturday morning until Tuesday's load the "current week" is
    // Sat+Sun: about 6% of a week's business, and none of it a weekday. Leading with that reads as a
    // collapse, three days out of every seven.
    //
    // So the current week only takes the headline once at least Monday is in (index 2). Before that
    // the last COMPLETE week leads, exactly as it did before — the comparison Kyle asked for is
    // preserved, it just doesn't get to shout a weekend at him. `currentWeekTooEarly` is returned so
    // the tile can say why rather than silently reverting. See isWeekendOnlyWeek for the full note.
    const currentWeekTooEarly = isWeekendOnlyWeek(asOf);
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
      const useLtd = partialLast && ltd != null && !currentWeekTooEarly;
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
        // the only one comparable with the quarter average. Suppressed when the headline IS that
        // week (i.e. the current week is being held back), so the tile doesn't print it twice.
        lastFullWeek:
          partialLast && useLtd
            ? { weekLabel: weeks[li], weekFrom: windowOf(li).from, weekTo: windowOf(li).to, value: series[li] ?? null }
            : null,
        /** Set only while the current week is held back for being weekend-only: its figure so far,
         *  shown small underneath rather than as the headline. The number is still on the board —
         *  it just isn't allowed to masquerade as a week. */
        currentWeekSoFar:
          currentWeekTooEarly && ltd != null
            ? { weekLabel: weeks[lastIdx], value: ltd[lastIdx] ?? null, throughDay: asOf }
            : null,
        delta: latest != null && prior != null ? round(latest - prior, 1) : null,
        deltaPct: latest != null && prior != null ? pctDelta(latest, prior) : null,
        // Quarter average is a WHOLE-week measure, so it stays anchored to the last complete week —
        // comparing four days against a 13-week average of full weeks would always read as behind.
        vsQuarterPct: series[li] != null && qa ? round((((series[li] as number) - qa) / qa) * 100, 1) : null,
      };
    };

    // SALES ORDER, and the charts below the tiles repeat it (Kyle, 2026-08-18: "the charts appear to
    // be all over the place and not following — could you please put these in sales order"). The
    // sequence is the business's own: a lead arrives, a mortgage is written, protection is opened
    // off the back of it, that is worth £, and the average case sizes it. Previously the tiles led
    // with Mortgages Written and buried Leads fourth, while the charts ran in a third order again —
    // so nothing on the screen read left to right in the order the work actually happens.
    const kpis = [
      // "New Client Leads", not "Lead Volume": same series, but it now counts new clients rather than
      // every case created, and a generic label is exactly how the old wider number got compared
      // against the platform's client-based report for a fortnight (see NEW_CLIENT_LEAD_BASIS).
      kpi("leads", "New Client Leads", leadsW, "int", leadsLtd),
      // "Mortgages Written", not "Applications": this counts mortgagecase rows by WrittenDate, i.e.
      // business written, not applications submitted (Kyle read it as the latter, 2026-07-28).
      kpi("applications", "Mortgages Written", appsW, "int", appsLtd),
      kpi("referrals", "Protection Referrals", refsW, "int", refsLtd),
      kpi("written", "Weekly Written", combW, "gbpk", writtenLtd),
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
    // hidden on the board until its actual is sourced. `completeIdx` — the last week that has both
    // ENDED and fully loaded — is computed above the fetch, because the commission league is queried
    // for the same window.
    const writtenTargets = getWrittenWeeklyTargets();
    const writtenTargetCombined = writtenTargets.mortgage + writtenTargets.insurance;
    // Same object as the league's window on purpose: one week, one definition, no way for the two
    // halves of the screen to drift onto different dates.
    const writtenWindow = leagueWindow;
    /** The subject week has not finished — so `combined.actual` is a week TO DATE, not a week. */
    const subjectPartial = writtenWindow.to < subjectEnd;
    const writtenBlock = {
      weekLabel: weeks[subjectIdx],
      weekFrom: weekStarts[subjectIdx],
      /** The week's Friday, so the label always describes a WEEK... */
      weekTo: subjectEnd,
      /** ...and this is the last day actually counted. Equal to `weekTo` on a finished week. */
      throughDay: writtenWindow.to,
      partial: subjectPartial,
      mortgage: { actual: Math.round(mortW[subjectIdx] ?? 0), target: Math.round(writtenTargets.mortgage) },
      insurance: { actual: Math.round(insW[subjectIdx] ?? 0), target: Math.round(writtenTargets.insurance) },
      combined: { actual: Math.round(combW[subjectIdx] ?? 0), target: Math.round(writtenTargetCombined) },
      /**
       * The prior week truncated to the SAME weekday — the only fair comparison for a part week, and
       * the one Kyle asked for (2026-08-07). Null on a finished week, where the prior full week is the
       * comparison and the graph beside it already draws that.
       */
      priorSameDay: subjectPartial ? (writtenLtd[subjectIdx - 1] ?? null) : null,
      priorWeekLabel: subjectIdx > 0 ? weeks[subjectIdx - 1] : null,
      /**
       * Full-week estimate for a part week. This — NOT the week-to-date actual — is the figure the
       * whole-week target can fairly be set against, which is why the target percentage on screen
       * hangs off it. Same value the graph's dashed segment ends on, so the number under the chart and
       * the point on it are the same thing.
       */
      forecast: subjectPartial ? writtenForecastTotal : null,
      /**
       * The last week that has both ended and loaded, kept alongside whenever it is not the subject.
       * It is the only figure on this screen comparable with a Total Written Report, which is run for
       * finished periods — so moving the subject to the current week must not take it off the page.
       */
      lastComplete:
        subjectIdx !== completeIdx
          ? {
              weekLabel: weeks[completeIdx],
              weekFrom: weekStarts[completeIdx],
              weekTo: shiftDays(weekStarts[completeIdx], 6),
              actual: Math.round(combW[completeIdx] ?? 0),
              provisional: shiftDays(shiftDays(weekStarts[completeIdx], 6), INPUT_LAG_SETTLE_DAYS) > asOf,
            }
          : null,
      /** Client fees written in the same window — NOT part of "written" (which is commission), shown
       *  so the gap to a fees-inclusive figure like Est. Revenue is explicit, not mysterious. */
      clientFees: Math.round(feeW[subjectIdx] ?? 0),
      /** Cases written whose WrittenDate falls in the week but were input later. Mean input lag is
       *  ~6 days and 22% of written £ arrives 8+ days late, so a week keeps climbing after it closes
       *  — and, per the snapshot history, sometimes falls. The board must say "provisional" rather
       *  than imply the figure is final (Kyle 2026-07-28). */
      provisional: shiftDays(subjectEnd, INPUT_LAG_SETTLE_DAYS) > asOf,
    };

    // ------------------------------------------------------------------ commission league (top 10)
    //
    // The right-hand half of this screen: the ten advisers who earned the most commission over the
    // SAME window the graph's headline reports (Luke, 2026-08-19 — "advisers' top 10 in terms of
    // commission in that time period … the graph will show the total business commission for that
    // week"). That window is now the CURRENT week to date — see `subjectIdx` — so the league is who
    // is earning it this week, not who earned it last week.
    //
    // ALL commission, not a product line. Mortgage, protection and general insurance are added
    // together and never split — "we'll call it mortgages, and that can be either protection,
    // mortgages, or general insurance. It doesn't actually matter which." The same ruling removed the
    // mortgage/protection split from the graph's footer, so there is now exactly ONE money basis on
    // the page: written commission. Nothing on this screen can be reconciled against anything else on
    // this screen and come out different, which is the whole point.
    //
    // `total` is taken from `combW` — the graph's own series — rather than re-summed from the adviser
    // rows, so the number under the league is by definition the number the graph draws. The rows and
    // the total come from different queries on the same basis and should agree to the penny; if they
    // ever don't, the visible share percentage is the thing that says so.
    const TOP_N = 10;
    const earnerBy = new Map<string, { name: string; commission: number; cases: number }>();
    let unattributed = 0;
    const credit = (username: string | null, fullName: string | null, commission: number | null, cases: number) => {
      const name = fullName?.trim() || username?.trim() || "";
      // Cases with no adviser on file: real commission, but not a person, so it cannot hold a place on
      // a league OF people. Carried out separately rather than silently dropped — the rows have to be
      // able to account for the firm total printed beneath them.
      //
      // A shared team inbox is the same thing wearing a name: `cs@` resolves to "Client Services",
      // which would otherwise have taken a place in the wall's commission league off the back of the
      // 60/40 split. Same bucket, same reason.
      if (!name || isSharedAccount(username)) {
        unattributed += commission ?? 0;
        return;
      }
      const row = earnerBy.get(name) ?? { name, commission: 0, cases: 0 };
      row.commission += commission ?? 0;
      row.cases += cases;
      earnerBy.set(name, row);
    };
    for (const r of mortByAdviser) credit(r.username, r.fullName, r.commission, r.cases);

    /**
     * PROTECTION, SPLIT 60/40 — Kyle, 2026-08-21: "They appear to still be receiving 100% and not the
     * 60/40? And the 40% needs to be going to the Mortgage Adviser."
     *
     * They were receiving 100%, because the league credited `ProductCommission` to the case's primary
     * adviser and stopped there. Two facts make the split possible now, and it is worth being precise
     * about which is read and which is inferred:
     *
     *   the 40% AMOUNT is read.      `protectioncase.SplitCommission` is populated on 102 of the 309
     *                               protection cases in the 90 days to 2026-08-21 and is exactly 40%
     *                               of ProductCommission on every one. Capricorn's own number.
     *   the RECIPIENT is inferred.   `SplitAdviserUserAccountKey` is populated on 1 of 309, so the
     *                               platform's recorded recipient is unusable. The mortgage adviser is
     *                               identified from the CLIENT instead (see referrals.ts), which
     *                               attributed £14,300 of the £15,709 split in W34 — 91%.
     *
     * So: the writing adviser keeps commission MINUS the split, and the split goes to the mortgage
     * adviser whose client it was. Three cases where it does not:
     *
     *   no split on the case      the writing adviser keeps all of it; nothing to hand over.
     *   self-referral             the protection adviser sourced the client themselves, so there is no
     *                             referring mortgage adviser and they keep the whole commission.
     *   no mortgage on the client the 40% is real money with no identifiable recipient. It goes to
     *                             `unattributed` — inside the firm total printed under the league,
     *                             absent from the rows — rather than being quietly left with the
     *                             writing adviser, which would overstate them by exactly the amount
     *                             the platform has already taken off.
     *
     * The FIRM TOTAL is untouched by any of this: it comes from the graph's own series and is 100% of
     * both legs. This only changes who inside it holds which share.
     */
    for (const r of protReferred) {
      const full = r.commission ?? 0;
      const split = r.splitCommission ?? 0;
      const selfReferral = r.originator != null && r.originator === r.converter;
      const handOver = selfReferral ? 0 : split;
      credit(r.converter, r.converterName, full - handOver, r.sales);
      // `credit` already routes a nameless adviser to `unattributed`, which is exactly what an
      // unidentifiable referrer needs — so the null-originator case needs no special handling here.
      if (handOver > 0) credit(r.originator, r.originatorName, handOver, 0);
    }
    const earners = [...earnerBy.values()]
      .filter((r) => r.commission > 0)
      .sort((a, b) => b.commission - a.commission || a.name.localeCompare(b.name));
    const leagueBlock = {
      weekLabel: weeks[subjectIdx],
      weekFrom: leagueWindow.from,
      weekTo: subjectEnd,
      /** Last day counted — the rows are "so far this week" while the subject week is running. */
      throughDay: leagueWindow.to,
      partial: subjectPartial,
      rows: earners.slice(0, TOP_N).map((r, i) => ({
        rank: i + 1,
        name: r.name,
        commission: Math.round(r.commission),
        cases: r.cases,
      })),
      /** Whole-firm written commission over the same window — the value the graph plots for it. */
      total: Math.round(combW[subjectIdx] ?? 0),
      /** Everyone who earned commission in the week, so "top 10" says what it is the top 10 OF. */
      earners: earners.length,
      /** Commission on cases with no adviser on file: inside `total`, absent from `rows`. */
      unattributed: Math.round(unattributed),
      /** Same input-lag caveat as the graph — a just-closed week is still filling. */
      provisional: writtenBlock.provisional,
    };

    return {
      dataAsOf: asOf,
      weeks,
      partialLastWeek: partialLast,
      /** True Sat–Mon, when the current week holds only weekend days: the tiles lead with the last
       *  complete week and show the current one underneath. See `currentWeekTooEarly` above. */
      currentWeekTooEarly,
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
      /** Top 10 commission earners for the same week `written` reports — the league beside the graph. */
      league: leagueBlock,
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

/**
 * Money for the ticker. The millions branch exists because the k-only version rendered a £1.2m
 * mortgage as "£1200k" (Capricorn 2026-08-18) — four digits and a "k" is harder to read at a glance
 * across a room than the thing it is, and it is the large cases people most want to see go past.
 * Two decimals matches gbpCompact on the client, so the same value reads the same on every screen.
 */
const gbp = (v: number | null | undefined): string => {
  if (v == null) return "";
  const n = Math.round(v);
  if (Math.abs(n) >= 1_000_000) return `£${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `£${Math.round(n / 1_000)}k`;
  return `£${n}`;
};

export interface FeedItem {
  kind: "application" | "lead" | "referral" | "sale" | "milestone";
  icon: string;
  text: string;
  accent: "none" | "green" | "gold";
}

export async function liveFeed(config: Config, _f: ReportFilters) {
  return cached("ds-live-feed", ttl(config), async () => {
    const [core, today] = await Promise.all([chaseCore(config), todaySoFar(config)]);
    /**
     * TODAY, once today has anything to show.
     *
     * This read `core.ctx.latestDay` — the last COMPLETE day — so on a Friday lunchtime a strip
     * headed "Latest Activity" was listing Thursday's business while today's was already loaded.
     * Capricorn, 2026-08-21: "surely that is basing it on the latest data, so it should be as of
     * today." Right, and the complete-day rule has no business here: the rule exists so a part-day is
     * never measured against a whole day's TARGET, and a feed of individual events measures nothing.
     * It just names things that happened.
     *
     * The fallback stays, because it is not about targets either — a weekend or a pre-dawn Monday has
     * almost no activity, and an empty strip on a wall reads as a broken board. So: today when today
     * has events, otherwise the last working day, and `dayLabel` says which. Thin is fine — at the
     * morning load the lake holds ~1.5% of a day (dayRecordedShare), so early on this is a handful of
     * events and the milestone lines carry the strip.
     */
    const todayCount = today ? sum(KPI_KEYS.map((k) => today.counts[k])) : 0;
    const showToday = today != null && todayCount > 0;
    const asOf = showToday ? today.date : core.ctx.latestDay;
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
      // The day count behind the events. `core.daily` stops at the last COMPLETE day, so when the
      // strip is on today it has to come from the today query instead — otherwise this line silently
      // disappears every morning (latestN would be 0), taking the day's headline count with it.
      const latestN = showToday ? today.counts[k] : dayTotal(core.daily[k], asOf);
      if (latestN > 0) {
        milestones.push({
          kind: "milestone",
          icon: "🎯",
          // "so far today" rather than the date: the number is still climbing, and printing it against
          // a date makes it look like the day's finished figure.
          text: showToday
            ? `${latestN} ${KPI_LABELS[k].toLowerCase()} so far today`
            : `${latestN} ${KPI_LABELS[k].toLowerCase()} on ${dayLabel}`,
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
      /** The entity Capricorn actually reconciles against. Kyle, 2026-08-10: "at the moment I am
       *  not even looking at Group (yet) — we are still trying to get CFM to align which it is
       *  not." So CFM is marked as the basis here and the screen leads with it.
       *
       *  The BOARD is deliberately NOT switched to CFM-only. Checked against the lake first: Hong
       *  Kong (144 mortgage cases in 90 days) and Shanghai (3) sit entirely under Consultancy (411),
       *  so a CFM-only board would show both offices as zero — the identical failure to Newmarket's
       *  retired logins, which took a fortnight to spot. Reconciliation is a scope question; the
       *  operational screens are not. */
      reconcilesToEntity: 486,
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
