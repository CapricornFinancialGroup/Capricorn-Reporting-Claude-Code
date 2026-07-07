// Targets & thresholds — the numbers the run chase is paced against.
//
// PLACEHOLDER, pending Arman's official Capricorn Targets Excel (Conor, 2026-07-07: "Arman can
// update first thing Monday and we then track Actuals against weekly Targets"). That live-editable
// source doesn't exist yet (no confirmed file, location or template), so — rather than leave the
// original strawman's flat, evenly-split numbers (which put Hammersmith, an ~90-adviser office, on
// the same 35-applications/day target as offices with a handful of advisers) — these are DATA-
// DERIVED: each office's trailing 4-week average (2026-06-08 → 2026-07-05, CFM migration-day
// excluded) with a +10% stretch; offices with negligible historical volume floored to a small
// non-zero target so they stay visible on the leaderboards. Business-wide = sum of offices.
// Still not real targets — swap for Arman's figures the moment they exist. Versioned config by
// design: no database, changes are a PR.
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

/** Business-wide daily targets — sum of the office targets below, ÷5. */
export const DAILY_TARGETS: KpiTargets = { leads: 126, applications: 24, referrals: 7, sales: 6 };

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

/** Target for one weekday (Mon..Fri, index 0..4) = weekly target × that day's weight.
 *  Friday carries 80% of a Mon–Thu day (Conor's weighting). */
export function dayTarget(weekly: number, dayIndex: number): number {
  const w = DAY_WEIGHTS[dayIndex] ?? DAY_WEIGHTS[0];
  return Math.round(weekly * w);
}

/** Weekly target for a KPI for one office. */
export function weeklyOfficeTarget(office: string, kpi: KpiKey): number {
  return (OFFICE_DAILY_TARGETS[office]?.[kpi] ?? 0) * 5;
}

// Per-office daily targets. PLACEHOLDER — data-derived (see file header), NOT Capricorn's real
// targets. Capricorn's Datarails "Adviser Mapping" export also carries real per-adviser targets
// ("Weekly Par" / "Monthly Par" / "Written Par" / "Paid Par") — summing those by office is a
// candidate real source once the "Par" semantics are confirmed (see docs). Weekly figures behind
// these dailies (weekly = daily × 5): Hammersmith 500/90/20/20, Mayfair 80/12/3/2, Newmarket
// 12/3/2/1, Hong Kong 10/3/2/1, Singapore 12/4/2/1, Türkiye 10/4/2/1, Shanghai/Dubai 3/1/1/1
// (nominal floor — negligible trailing volume, kept non-zero so they stay visible). Unassigned
// carries none by design.
export const OFFICE_DAILY_TARGETS: Record<string, KpiTargets> = {
  Hammersmith: { leads: 100, applications: 18, referrals: 4, sales: 4 },
  Mayfair: { leads: 16, applications: 2.4, referrals: 0.6, sales: 0.4 },
  Newmarket: { leads: 2.4, applications: 0.6, referrals: 0.4, sales: 0.2 },
  "Hong Kong": { leads: 2, applications: 0.6, referrals: 0.4, sales: 0.2 },
  Singapore: { leads: 2.4, applications: 0.8, referrals: 0.4, sales: 0.2 },
  "Türkiye": { leads: 2, applications: 0.8, referrals: 0.4, sales: 0.2 },
  Shanghai: { leads: 0.6, applications: 0.2, referrals: 0.2, sales: 0.2 },
  Dubai: { leads: 0.6, applications: 0.2, referrals: 0.2, sales: 0.2 },
  [UNASSIGNED]: { leads: 0, applications: 0, referrals: 0, sales: 0 },
};

/** Daily revenue target, £. PLACEHOLDER like the KPI targets above — trailing 4-week average
 *  written-day revenue (2026-06-08 → 2026-07-05, migration batch excluded) was ~£44.8k/day
 *  (£896,146 / 20 working days), +10% stretch, rounded. Swap for Arman's figure once it exists. */
export const REVENUE_DAILY_TARGET = 50_000;

/** Funnel-health alert thresholds (strawman screen 4). */
export const ALERT_THRESHOLDS = {
  /** Protection sales ÷ protection referrals below this = critical alert. */
  protectionConversionMin: 0.5,
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
