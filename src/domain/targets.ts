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

// Display labels. `applications` reads "Mortgages Written" because that is what it counts:
// mortgagecase rows by WrittenDate, i.e. business written, NOT applications submitted to a lender.
// Called "Applications" it was read as the latter (Kyle 2026-07-28). The KEY stays `applications` —
// it's the targets-upload column name and the API contract.
export const KPI_LABELS: Record<KpiKey, string> = {
  leads: "Leads",
  applications: "Mortgages Written",
  // "Opportunities", not "Referrals": this counts protection cases OPENED. Capricorn records no
  // referral event — see PROTECTION_OPPORTUNITY_NOTE in domain/data-quality.ts.
  referrals: "Protection Opportunities",
  sales: "Protection Sales",
};

export const KPI_KEYS: KpiKey[] = ["leads", "applications", "referrals", "sales"];

export type KpiTargets = Record<KpiKey, number>;

/** Business-wide daily targets — sum of the office targets below. Leads = 633/wk (Kyle 2026-07-14,
 *  see OFFICE_DAILY_TARGETS); referrals mirror sales (the protection pledge is both). */
export const DAILY_TARGETS: KpiTargets = { leads: 126.6, applications: 23, referrals: 5, sales: 5 };

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

// Per-office daily targets (weekly = daily × 5). Mixed provenance now that Capricorn has confirmed
// some of these (Kyle, 2026-07-14):
//   • LEADS — CONFIRMED. 633 leads/wk group target, split across offices weighted by adviser
//     headcount (Kyle's rule: ~10 leads/adviser/wk). Headcount from the Datarails Adviser Mapping
//     (domain/offices.ts): Hammersmith 55, Mayfair 6, Newmarket 4, Hong Kong 2, Singapore 3,
//     Shanghai 1 (71 total → ~8.9 leads each) → weekly 490/53/36/18/27/9. Dubai has no mapped
//     advisers → 0. Weekly ÷ 5 below.
//   • REFERRALS = SALES — CONFIRMED. The protection "pledge" is one weekly activity number that is
//     both the referral target and the sales target (Kyle), so referrals mirrors sales here (actual
//     referrals-made comes from the lake → drives the target-vs-actual %). The Datarails import
//     mirrors the same way (server/routes/targets.ts).
//   • APPLICATIONS, SALES, REVENUE — still PLACEHOLDER (data-derived, see file header). Kyle asked
//     us to hold Applications as a fixed benchmark for now; it'll auto-consume once their Weekly_Par
//     tab starts updating. Sales here is the placeholder pending the real weekly pledge from file.
// No Türkiye row (Conor confirmed 2026-07-07 there's no Turkey office — its 2 advisers are
// UNASSIGNED pending a real mapping). Unassigned carries none by design.
export const OFFICE_DAILY_TARGETS: Record<string, KpiTargets> = {
  Hammersmith: { leads: 98, applications: 18, referrals: 4, sales: 4 },
  Mayfair: { leads: 10.6, applications: 2.4, referrals: 0.4, sales: 0.4 },
  Newmarket: { leads: 7.2, applications: 0.6, referrals: 0.2, sales: 0.2 },
  "Hong Kong": { leads: 3.6, applications: 0.6, referrals: 0.2, sales: 0.2 },
  Singapore: { leads: 5.4, applications: 0.8, referrals: 0.2, sales: 0.2 },
  Shanghai: { leads: 1.8, applications: 0.2, referrals: 0.2, sales: 0.2 },
  Dubai: { leads: 0, applications: 0.2, referrals: 0.2, sales: 0.2 },
  [UNASSIGNED]: { leads: 0, applications: 0, referrals: 0, sales: 0 },
};

/** Weekly WRITTEN targets, £. Kyle 2026-07-14 confirmed "Revenue" = written business, split
 *  Mortgage + Insurance, each target-vs-actual, combined for the headline. Values are the
 *  business-wide weekly totals from Capricorn's Weekly Written Targets files (Arman, week
 *  2026-07-04): Mortgage £359,550/wk, Insurance £75,200/wk. Uploadable via /api/targets/import-written
 *  (parseWrittenTargets.ts) — these are the fallback until an upload lands, same pattern as the KPI
 *  targets above.
 *
 *  ⚠ Actuals do NOT come from vw_total_written_by_product — that view holds loan value and policy
 *  amount, not commission (see the removal note in services/reporting/momentum.ts). They come from
 *  mortgagecase/protectioncase commission keyed on the platform's status dates; see
 *  MORTGAGE_WRITTEN_DATE in domain/data-quality.ts for the reconciliation. */
export interface WrittenTargets {
  mortgage: number;
  insurance: number;
}
export const WRITTEN_WEEKLY_TARGET: WrittenTargets = { mortgage: 359_550, insurance: 75_200 };

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
