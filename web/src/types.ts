// Payload types for the datasets (mirrors src/services/reporting/datasets.ts on the server).

export type KpiKey = "leads" | "applications" | "referrals" | "sales";
export type PaceStatus = "ahead" | "on_pace" | "behind";
export type ChaseStatus = "ahead" | "on_pace" | "behind" | "critical";

export interface TargetsProvenance {
  source: "placeholder" | "upload";
  effectiveWeek: string | null;
  uploadedBy: string | null;
  uploadedAt: string | null;
  note?: string;
}

export interface Meta {
  offices: Array<{ name: string; color: string }>;
  targets: {
    daily: Record<KpiKey, number>;
    weekly: Record<KpiKey, number>;
    officeDaily: Record<string, Record<KpiKey, number>>;
    /** WEEKLY written targets, £ — Mortgage + Insurance (the dashboard's "Revenue"). */
    writtenWeekly: { mortgage: number; insurance: number };
  };
  targetsProvenance: TargetsProvenance;
  /** True only for the signed-in viewer's own request (never on the kiosk) — gates the
   *  Targets/Glossary nav tabs on the frontend. The upload route enforces the same check
   *  server-side regardless of what the nav shows. */
  isTargetsAdmin: boolean;
  dataAsOf: string;
  /** ISO wall-clock of the lake's last load. The share reloads 5× daily (~07:50/11:10/14:15/17:10/
   *  20:10), NOT overnight — the header shows this so "is it live?" is answerable at a glance. */
  lastRefreshAt: string | null;
  refreshCadence: string;
  refreshSeconds: number;
  cycleSeconds: number;
  pacingMode: "mtd" | "drip";
  timeZone: string;
}

export interface Pace {
  target: number;
  current: number;
  expectedByNow: number;
  aheadBehind: number;
  projectedFinish: number;
  status: PaceStatus;
}

export interface ChaseChart {
  days: string[];
  actual: Array<number | null>;
  targetPace: number[];
  projection: Array<number | null>;
}

export interface WeekProgress {
  actualPct: number | null;
  expectedPct: number | null;
  /** +ahead / −behind, percentage points of the weekly target. */
  gapPp: number | null;
}

export interface DayView {
  date: string;
  actual: number;
  target: number;
  gap: number;
  status: ChaseStatus;
}

export interface DailyRunChasePayload {
  dataAsOf: string;
  /** Total mortgage value written this chase week (SUM(MortgageValue)) — not commission revenue. */
  totalWritten: number;
  /** TODAY's part-day counts, held apart from the chase so pace maths stays on complete days.
   *  Null at weekends. `loadedAt` is the load that produced them — the share reloads 5× daily. */
  today: { date: string; loadedAt: string | null; counts: Record<KpiKey, number> } | null;
  week: {
    start: string;
    end: string;
    days: string[];
    /** Cumulative expected share by end of each of the SEVEN days, Sat..Fri (%). Blended across the
     *  four KPIs — each card paces on its own curve, because Saturday is ~6% of a week's leads but
     *  ~1.5% of its written business. */
    cumulativeSharesPct: number[];
    /** Day labels for `days`, i.e. ["Sat","Sun","Mon",…,"Fri"]. */
    dayNames: string[];
    fraction: number;
    expectedPct: number;
    nowLabel: string;
    /** Most recent day with data — can now be a Saturday. */
    latestDay: string;
    /** True when the current week has no loaded data yet (early Monday). */
    pending: boolean;
  };
  kpis: Array<{
    key: KpiKey;
    label: string;
    weeklyTarget: number;
    wtd: number;
    pace: Pace;
    day: DayView;
    weekProgress: WeekProgress;
    chart: ChaseChart;
  }>;
  leaderboard: Array<{
    office: string;
    color: string;
    leads: number;
    applications: number;
    referrals: number;
    sales: number;
    latest: Record<KpiKey, number>;
    pct: number | null;
    status: ChaseStatus;
    hasTargets: boolean;
  }>;
}

export interface OfficeRunChasePayload {
  dataAsOf: string;
  week: { nowLabel: string; start: string; end: string; expectedPct: number; pending: boolean };
  offices: Array<{
    office: string;
    color: string;
    hasTargets: boolean;
    active: boolean;
    kpis: Array<{
      key: KpiKey;
      label: string;
      actual: number;
      target: number;
      expected: number;
      gap: number;
      status: ChaseStatus;
    }>;
    pct: number | null;
    status: ChaseStatus;
    chart: { days: string[]; actualPct: Array<number | null>; targetPct: number[] };
    rank: number | null;
  }>;
  champion: string | null;
}

export interface AdviserLeaguePayload {
  window: { from: string; to: string; weekdays: number; weeks: number };
  totals: {
    applications: number;
    referrals: number;
    sales: number;
    /** Commission + client fees — deliberately wider than Momentum's "Weekly Written" (commission
     *  only). Both parts are returned so the difference is explicit. */
    revenue: number;
    commission: number;
    clientFees: number;
    avgConversion: number | null;
  };
  top: Array<{
    name: string;
    office: string;
    apps: number;
    refs: number;
    sales: number;
    avgPerDay: number | null;
    trend: number[];
    trendDir: "up" | "flat" | "down";
  }>;
  improved: Array<{
    name: string;
    office: string;
    thisApps: number;
    thisRefs: number;
    lastApps: number;
    lastRefs: number;
    deltaPct: number | null;
  }>;
  focus: Array<{
    name: string;
    office: string;
    apps: number;
    refs: number;
    note: string;
    trendDir: "up" | "flat" | "down";
  }>;
}

export interface FunnelHealthPayload {
  dataAsOf: string;
  window: { from: string; to: string };
  stages: Array<{ key: string; label: string; count: number }>;
  conversions: Array<{ from: string; to: string; pct: number }>;
  applicationsReferralsGap: { weeks: string[]; applications: number[]; referrals: number[] };
}

export interface MomentumKpi {
  key: string;
  label: string;
  fmt: "int" | "gbp" | "gbpk";
  latest: number | null;
  weekLabel: string;
  /** The tile's ACTUAL window (inclusive, Sat–Fri). Rendered on the tile: the tiles report the last
   *  COMPLETE week while the run-chase screens report the current one, and a bare "W30" gave no way
   *  to tell them apart (Kyle 2026-07-28). */
  weekFrom: string;
  weekTo: string;
  priorWeekLabel: string | null;
  /** True when this week's WrittenDate-keyed figure is still filling from input lag — mean 6 days,
   *  so a just-closed week is not final. */
  provisional: boolean;
  delta: number | null;
  deltaPct: number | null;
  vsQuarterPct: number | null;
  /** Where the week IN PROGRESS has got to. The headline above is the last COMPLETE week — that is
   *  the only window whose delta and quarter-average compare like with like — but a headline up to
   *  six days old reads as a frozen screen (Kyle, 2026-08-04: "Still showing week to 31 Jul?").
   *  Null when the last bucket is already complete. */
  current: {
    weekLabel: string;
    weekFrom: string;
    weekTo: string;
    /** Last complete day included in `soFar`. */
    throughDay: string;
    soFar: number | null;
  } | null;
}

export interface MarketMomentumPayload {
  dataAsOf: string;
  weeks: string[];
  partialLastWeek: boolean;
  series: {
    applications: number[];
    referrals: number[];
    /** Actual weekly WRITTEN business £k (Mortgage + Insurance) — stops (null) at the current,
     *  still-in-progress week. */
    writtenActualK: Array<number | null>;
    /** Null except a two-point segment: [last complete week's actual, current week's day-by-day
     *  forecast] — renders as a dashed "chipping away" projection from the actual line's end. */
    writtenForecastK: Array<number | null>;
    leads: number[];
    avgCaseSizeK: Array<number | null>;
    referralRatePct: Array<number | null>;
  };
  /** Written business vs target for the latest COMPLETE week (£), split by product + combined.
   *  "Written" is COMMISSION; `clientFees` is carried alongside, never folded in. */
  written: {
    weekLabel: string;
    weekFrom: string;
    weekTo: string;
    mortgage: { actual: number; target: number };
    insurance: { actual: number; target: number };
    combined: { actual: number; target: number };
    clientFees: number;
    provisional: boolean;
  };
  /** Combined weekly written target, £k — reference line on the Weekly Written trend. */
  writtenTargetCombinedK: number;
  kpis: MomentumKpi[];
  referralRateTargetPct: number;
  verdict: string;
}

export interface FeedItem {
  kind: "application" | "lead" | "referral" | "sale" | "milestone";
  icon: string;
  text: string;
  accent: "none" | "green" | "gold";
}

export interface LiveFeedPayload {
  dataAsOf: string;
  dayLabel: string;
  items: FeedItem[];
}

// --------------------------------------------------------------- definitions

/** Confidence the board is claiming for a figure — rendered as a badge wherever it appears. */
export type MetricStatus = "agreed" | "indicative" | "open";

/** One metric's single agreed definition. Mirrors src/domain/metrics.ts, which is the only place a
 *  definition is written down (Conor 2026-08-04: one definition per KPI, clickable from the tile). */
export interface MetricDefinition {
  key: string;
  label: string;
  definition: string;
  calculation: string;
  source: string;
  reconcilesTo: string | null;
  owner: string;
  frequency: string;
  status: MetricStatus;
  note?: string;
}

export interface DefinitionsPayload {
  cadence: { summary: string; asOfRule: string; refresh: string };
  metrics: MetricDefinition[];
}
