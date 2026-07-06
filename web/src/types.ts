// Payload types for the datasets (mirrors src/services/reporting/datasets.ts on the server).

export type KpiKey = "leads" | "applications" | "referrals" | "sales";
export type PaceStatus = "ahead" | "on_pace" | "behind";
export type ChaseStatus = "ahead" | "on_pace" | "behind" | "critical";

export interface Meta {
  offices: Array<{ name: string; color: string }>;
  targets: {
    daily: Record<KpiKey, number>;
    officeDaily: Record<string, Record<KpiKey, number>>;
    revenueDaily: number;
  };
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

export interface DailyRunChasePayload {
  dataAsOf: string;
  month: {
    start: string;
    end: string;
    workingDaysElapsed: number;
    workingDaysTotal: number;
    fraction: number;
    nowLabel: string;
  };
  kpis: Array<{
    key: KpiKey;
    label: string;
    dailyTarget: number;
    monthlyTarget: number;
    mtd: number;
    latestDay: number;
    pace: Pace;
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
  month: { nowLabel: string; workingDaysElapsed: number; workingDaysTotal: number };
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
    revenue: number;
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
  stageMetrics: Array<{ stage: string; count: number; avgAgeDays: number | null }>;
  alerts: Array<{ severity: "critical" | "warning"; title: string; detail: string }>;
  donut: { written: number; referred: number; notReferred: number; referredPct: number | null };
  queues: Array<{ key: string; label: string; count: number; sub: string }>;
  pipeline: {
    inFlightCount: number;
    inFlightValue: number;
    avgCaseSize: number;
    protectionOpen: number;
    revenueLatestDay: number;
    revenueTarget: number;
    gap: number;
  };
}

export interface MomentumKpi {
  key: string;
  label: string;
  fmt: "int" | "gbp" | "gbpk";
  latest: number | null;
  weekLabel: string;
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
    revenueK: Array<number | null>;
    leads: number[];
    avgCaseSizeK: Array<number | null>;
    referralRatePct: Array<number | null>;
  };
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
