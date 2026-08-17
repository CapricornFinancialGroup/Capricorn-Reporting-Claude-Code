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

export type KpiKey = "leads" | "applications" | "referrals" | "sales" | "existingCases";

/** KPIs Capricorn have set a target for. `existingCases` is tracked but deliberately untargeted (see
 *  NEW_CLIENT_LEAD_BASIS) — it must not drag the blended pace curve or an office's pace average
 *  toward a target that does not exist. */
export const TARGETED_KPI_KEYS: KpiKey[] = ["leads", "applications", "referrals", "sales"];

// Display labels. `applications` reads "Mortgages Written" because that is what it counts:
// mortgagecase rows by WrittenDate, i.e. business written, NOT applications submitted to a lender.
// Called "Applications" it was read as the latter (Kyle 2026-07-28). The KEY stays `applications` —
// it's the targets-upload column name and the API contract.
export const KPI_LABELS: Record<KpiKey, string> = {
  // "New Client Leads", not "Leads": from 2026-08-17 this counts new CLIENTS, not new cases, so the
  // label has to say which — a bare "Leads" is what let the old, wider number be compared against
  // the platform's client-based report for a fortnight. See NEW_CLIENT_LEAD_BASIS.
  leads: "New Client Leads",
  applications: "Mortgages Written",
  // "Opportunities", not "Referrals": this counts protection cases OPENED. Capricorn records no
  // referral event — see PROTECTION_OPPORTUNITY_NOTE in domain/data-quality.ts.
  referrals: "Protection Opportunities",
  sales: "Protection Sales",
  existingCases: "Existing Client Cases",
};

export const KPI_KEYS: KpiKey[] = ["leads", "applications", "referrals", "sales", "existingCases"];

export type KpiTargets = Record<KpiKey, number>;

/** Business-wide daily targets — sum of the office targets below. Leads = 633/wk (Kyle 2026-07-14,
 *  see OFFICE_DAILY_TARGETS); referrals mirror sales (the protection pledge is both).
 *
 *  ⚠ The leads figure is on the OLD basis. 633/wk was set by headcount against a count that included
 *  remortgages and repeat clients; leads now means new clients only, which runs ~16% lower on the same
 *  weeks. Kept unchanged rather than quietly rebased — inventing a target is Capricorn's call, not
 *  ours — and flagged on-screen. `existingCases` is 0: untargeted by design, not an oversight. */
export const DAILY_TARGETS: KpiTargets = { leads: 126.6, applications: 23, referrals: 5, sales: 5, existingCases: 0 };

// ---------------------------------------------------------------------------
// Weekly run chase (Conor's principles, 2026-07-06 email)
// ---------------------------------------------------------------------------
//
// Everything is measured against a WEEKLY target spread across the days of Capricorn's Sat–Fri week.
//
// Conor's rule (2026-07-06) sets the WEEKDAY shape: Mon–Thu carry equal weight and Friday 80% of a
// Mon–Thu day, i.e. 5 : 5 : 5 : 5 : 4. That is unchanged and still the agreed rule.
//
// What was wrong until 2026-08-04 is that the curve ended there — Saturday and Sunday were given
// ZERO expected share, so a day Capricorn actually trades was treated as if the firm were shut.
// Kyle: "we do Saturday coverage which can result in circa 50+ leads … this is why we run our week
// Sat–Friday to capture that." He is right, and the data agrees (8 whole weeks, Sat 6 Jun – Fri 31
// Jul 2026, CFM migration day excluded, per-day averages):
//
//                     Sat    Sun    Mon    Tue    Wed    Thu    Fri
//   Leads            36.3    7.6  134.4  112.1   98.0  106.6   94.8   → Sat 6.1%, Sun 1.3%
//   Mortgages written 2.4    3.5   33.8   38.4   30.0   35.3   21.1   → Sat 1.4%, Sun 2.1%
//   Prot. opps        1.0    0.0   14.5    9.8   11.1   11.6    7.9   → Sat 1.8%, Sun 0.0%
//   Prot. written     1.0    0.0    5.0    6.3    5.0    6.9    3.1   → Sat 3.7%, Sun 0.0%
//
// So the weekend matters a lot for LEADS (enquiries arrive while people are house-hunting) and
// barely at all for WRITTEN business (cases get progressed on weekdays). One shared curve cannot be
// honest about both, so the weekend allowance is per-KPI; the weekday remainder is always split on
// Conor's 5:5:5:5:4. Rounded to half a percent — these are targets, not measurements, and false
// precision here would imply the curve is more certain than eight weeks of data can support.

/** Observed weekend share of the weekly total, per KPI: [Saturday, Sunday]. */
const WEEKEND_SHARES: Record<KpiKey, [number, number]> = {
  leads: [0.060, 0.015],
  applications: [0.015, 0.020],
  referrals: [0.020, 0.000],
  sales: [0.035, 0.000],
  // New enquiries arrive at the weekend; remortgage and repeat work is opened by advisers on weekdays.
  // Observed Sat 8 – Fri 14 Aug: 2 of 111 existing-client cases fell on the Saturday, 0 on the Sunday.
  // Only shapes the day curve, which nothing paces against while this KPI has no target.
  existingCases: [0.020, 0.000],
};

/** Conor's weekday shape — Mon–Thu equal, Fri 80% of a Mon–Thu day. */
const WEEKDAY_RATIO = [5, 5, 5, 5, 4];

/** Day-of-week order of the chase week. Index 0 = Saturday, index 6 = Friday. */
export const WEEK_DAY_NAMES = ["Sat", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri"] as const;

/** Share of the weekly target falling on each day of the Sat–Fri week (index 0 = Sat), per KPI.
 *  Each row sums to 1. Weekend from observed share; weekdays share the remainder on 5:5:5:5:4. */
export const DAY_WEIGHTS: Record<KpiKey, number[]> = Object.fromEntries(
  KPI_KEYS.map((k) => {
    const [sat, sun] = WEEKEND_SHARES[k];
    const weekdayTotal = 1 - sat - sun;
    const ratioSum = WEEKDAY_RATIO.reduce((a, b) => a + b, 0);
    return [k, [sat, sun, ...WEEKDAY_RATIO.map((r) => (weekdayTotal * r) / ratioSum)]];
  }),
) as Record<KpiKey, number[]>;

/** Cumulative expected share by END of each day of the Sat–Fri week, per KPI. */
export const CUMULATIVE_WEEK_SHARES: Record<KpiKey, number[]> = Object.fromEntries(
  KPI_KEYS.map((k) => [
    k,
    DAY_WEIGHTS[k].reduce<number[]>((acc, w) => {
      acc.push((acc[acc.length - 1] ?? 0) + w);
      return acc;
    }, []),
  ]),
) as Record<KpiKey, number[]>;

/** KPI-agnostic curve, for the few places that pace a mixed or unspecified measure (Momentum's
 *  partial-week extrapolation, the League's most-improved). The straight mean of the TARGETED KPI
 *  curves — never used where the KPI is known, because then the KPI's own curve is more honest.
 *  Untargeted KPIs are excluded so adding one cannot silently shift everything paced by this. */
export const BLENDED_CUMULATIVE_SHARES: number[] = WEEK_DAY_NAMES.map((_, i) =>
  TARGETED_KPI_KEYS.reduce((sum, k) => sum + CUMULATIVE_WEEK_SHARES[k][i], 0) / TARGETED_KPI_KEYS.length,
);

/** Weekly target for a KPI (business-wide). Team-Targets feed plugs in here. */
export function weeklyTarget(kpi: KpiKey): number {
  return DAILY_TARGETS[kpi] * 5;
}

/** Target for one day of the Sat–Fri week (index 0 = Sat … 6 = Fri) = weekly target × that day's
 *  share for THAT KPI. Saturday is no longer zero — see the table above. */
export function dayTarget(kpi: KpiKey, weekly: number, dayIndex: number): number {
  const w = DAY_WEIGHTS[kpi][dayIndex] ?? DAY_WEIGHTS[kpi][2];
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
  Hammersmith: { leads: 98, applications: 18, referrals: 4, sales: 4, existingCases: 0 },
  Mayfair: { leads: 10.6, applications: 2.4, referrals: 0.4, sales: 0.4, existingCases: 0 },
  Newmarket: { leads: 7.2, applications: 0.6, referrals: 0.2, sales: 0.2, existingCases: 0 },
  "Hong Kong": { leads: 3.6, applications: 0.6, referrals: 0.2, sales: 0.2, existingCases: 0 },
  Singapore: { leads: 5.4, applications: 0.8, referrals: 0.2, sales: 0.2, existingCases: 0 },
  Shanghai: { leads: 1.8, applications: 0.2, referrals: 0.2, sales: 0.2, existingCases: 0 },
  Dubai: { leads: 0, applications: 0.2, referrals: 0.2, sales: 0.2, existingCases: 0 },
  [UNASSIGNED]: { leads: 0, applications: 0, referrals: 0, sales: 0, existingCases: 0 },
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
