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
  week: {
    start: string;
    end: string;
    days: string[];
    /** Cumulative expected share by end of Mon..Fri, % (20.83 / 41.67 / 62.5 / 83.33 / 100). */
    cumulativeSharesPct: number[];
    fraction: number;
    expectedPct: number;
    nowLabel: string;
    latestWorkingDay: string;
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
