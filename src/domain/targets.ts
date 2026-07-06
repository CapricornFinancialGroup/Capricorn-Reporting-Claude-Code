// Targets & thresholds — the numbers the run chase is paced against.
//
// PLACEHOLDER — every figure here is seeded from the strawman screens Capricorn signed off
// (daily targets: 140 leads / 35 apps / 20 referrals / 10 protection sales) and needs confirming
// by Capricorn before the numbers are treated as real. Versioned config by design: no database,
// changes are a PR.
//
// Monthly targets are derived: daily target × working days in the month (Mon–Fri).

import { UNASSIGNED } from "./offices.js";

export type KpiKey = "leads" | "applications" | "referrals" | "sales";

export const KPI_LABELS: Record<KpiKey, string> = {
  leads: "Leads",
  applications: "Applications",
  referrals: "Protection Referrals",
  sales: "Protection Sales",
};

export const KPI_KEYS: KpiKey[] = ["leads", "applications", "referrals", "sales"];

export type KpiTargets = Record<KpiKey, number>;

/** Business-wide daily targets (strawman screen 1). */
export const DAILY_TARGETS: KpiTargets = { leads: 140, applications: 35, referrals: 20, sales: 10 };

// ---------------------------------------------------------------------------
// Weekly run chase (Conor's principles, 2026-07-06 email)
// ---------------------------------------------------------------------------
//
// Everything is measured against a WEEKLY target, distributed across the five working days with
// Friday carrying 80% of a Mon–Thu day's weight:
//   Mon–Thu = 5/24 (20.83%) each, Fri = 4/24 (16.67%)  → cumulative 20.83 / 41.67 / 62.50 / 83.33 / 100%.
// Targets are meant to refresh each Monday 09:00 from the latest Team Targets — that dynamic
// source doesn't exist yet, so weeklyTarget() derives from the config daily targets (daily × 5)
// and is THE seam to re-point when Capricorn provides a live Team Targets feed.

/** Mon..Fri share of the weekly target (sums to 1). */
export const DAY_WEIGHTS: number[] = [5 / 24, 5 / 24, 5 / 24, 5 / 24, 4 / 24];

/** Cumulative expected share of the weekly target by end of Mon..Fri. */
export const CUMULATIVE_WEEK_SHARES: number[] = DAY_WEIGHTS.reduce<number[]>((acc, w) => {
  acc.push((acc[acc.length - 1] ?? 0) + w);
  return acc;
}, []);

/** Weekly target for a KPI (business-wide). Team-Targets feed plugs in here. */
export function weeklyTarget(kpi: KpiKey): number {
  return DAILY_TARGETS[kpi] * 5;
}

/** Weekly target for a KPI for one office. */
export function weeklyOfficeTarget(office: string, kpi: KpiKey): number {
  return (OFFICE_DAILY_TARGETS[office]?.[kpi] ?? 0) * 5;
}

/** Per-office daily targets (strawman screen 2). Unassigned carries no target. */
export const OFFICE_DAILY_TARGETS: Record<string, KpiTargets> = {
  Hammersmith: { leads: 35, applications: 9, referrals: 5, sales: 3 },
  Mayfair: { leads: 28, applications: 7, referrals: 4, sales: 2 },
  Singapore: { leads: 25, applications: 6, referrals: 4, sales: 2 },
  Newmarket: { leads: 21, applications: 5, referrals: 3, sales: 1 },
  "Hong Kong": { leads: 17, applications: 4, referrals: 2, sales: 1 },
  Shanghai: { leads: 14, applications: 4, referrals: 2, sales: 1 },
  [UNASSIGNED]: { leads: 0, applications: 0, referrals: 0, sales: 0 },
};

/** Daily revenue target, £ (strawman ticker: "on pace for £65k revenue"). Indicative. */
export const REVENUE_DAILY_TARGET = 65_000;

/** Funnel-health alert thresholds (strawman screen 4). */
export const ALERT_THRESHOLDS = {
  /** Protection sales ÷ protection referrals below this = critical alert. */
  protectionConversionMin: 0.5,
  /** Applications → lender-offer flow rate below this = warning. (The strawman's meeting→app rate
   *  isn't computable: Capricorn's workflow meeting dates went dark after April 2026.) */
  appToOfferRateMin: 0.5,
  /** Applications older than this (days) with no lender offer = aged. */
  agedApplicationDays: 7,
};

/** Adviser-league config (strawman screen 3). */
export const LEAGUE = {
  /** Advisers at or below this many applications in the window land in "Focus This Month". */
  focusAppsThreshold: 2,
  /** Referral rate ≥ this while apps are low = the "apps low, refs strong" mixed signal. */
  mixedSignalRefsPerApp: 5,
};

/** Weekly protection-referral-rate reference line (strawman screen 5), fraction of applications. */
export const REFERRAL_RATE_TARGET = 0.3;

/** Working days (Mon–Fri) in the month containing `dateIso`. */
export function workingDaysInMonth(dateIso: string): number {
  const [y, m] = dateIso.split("-").map(Number);
  let count = 0;
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  for (let d = 1; d <= days; d++) {
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    if (dow !== 0 && dow !== 6) count++;
  }
  return count;
}

/** Working days from the 1st of the month up to AND INCLUDING `dateIso` (its month). */
export function workingDaysElapsed(dateIso: string): number {
  const [y, m, day] = dateIso.split("-").map(Number);
  let count = 0;
  for (let d = 1; d <= day; d++) {
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    if (dow !== 0 && dow !== 6) count++;
  }
  return count;
}

/** Monthly target = daily target × working days in the month of `dateIso`. */
export function monthlyTarget(daily: number, dateIso: string): number {
  return daily * workingDaysInMonth(dateIso);
}
