// Adviser League (screen 3) query builders — per-adviser revenue; the per-adviser KPI counts come
// from kpis.kpiDailyByAdviser so the league always agrees with the run-chase screens.

import { MORTGAGE_WRITTEN_DATE, PROTECTION_WRITTEN_DATE, PROTECTION_WRITTEN_STATUSES } from "../../domain/data-quality.js";
import { combine, dateRange, notDeleted, orgFilter, whereClause } from "./filters.js";
import type { BuiltQuery } from "./query.js";

export interface AdviserRevenue {
  username: string | null;
  fullName: string | null;
  commission: number | null;
  clientFees: number | null;
  /** Written mortgage cases behind the commission — the row detail on Momentum's commission league,
   *  so a large number is readable as "eleven cases" rather than as an unexplained total. */
  cases: number;
}

/** Every known adviser (username + display name), no date/activity filter — a name-resolution
 *  lookup for matching external sources (e.g. the Datarails targets workbook) to offices via
 *  domain/offices.ts, not a KPI query. */
export function adviserRoster(): BuiltQuery {
  return { text: `SELECT DISTINCT Username AS username, FullName AS fullName FROM dbo.useraccount;`, params: [] };
}

/** Estimated mortgage revenue per adviser over [from, to] (written cases). INDICATIVE — commission
 *  plus client fees, which is deliberately a WIDER measure than Momentum's "Weekly Written"
 *  (commission only, Capricorn's Total Written basis). Returned split so the two are reconcilable
 *  instead of being one number under two names (Kyle 2026-07-28).
 *
 *  "Commission + Fees", which Kyle asked about on 2026-08-04, is exactly this pair: commission is the
 *  lender's procuration fee (`ProductCommission`, the column their own report sums); FEES is the
 *  CLIENT fee — the advice/arrangement fee charged to the client (`ClientFeeAmount`). Same
 *  construction the platform uses: `TotalFeesDue = ProductCommission + ClientFee` in
 *  usp_GetInsuranceProductReport. It excludes solicitor and miscellaneous fees, which are separate
 *  columns on the case and are NOT counted here.
 *
 *  No migration guard: it keys on LeadDate and was deleting genuine written business — see
 *  excludeMigrations in filters.ts. */
export function revenueByAdviser(from: string, to: string): BuiltQuery {
  const where = combine(orgFilter("f"), notDeleted("f"), dateRange(`f.${MORTGAGE_WRITTEN_DATE}`, from, to));
  return {
    text: `SELECT adv.Username AS username, adv.FullName AS fullName,
                  SUM(COALESCE(f.ProductCommission, 0)) AS commission,
                  SUM(COALESCE(f.ClientFeeAmount, 0)) AS clientFees,
                  COUNT(*) AS cases
             FROM dbo.mortgagecase f
             LEFT JOIN dbo.useraccount adv ON adv.UserAccountKey = f.PrimaryAdviserUserAccountKey
            ${whereClause(where)}
            GROUP BY adv.Username, adv.FullName;`,
    params: where.params,
  };
}

export interface AdviserProtectionCommission {
  username: string | null;
  fullName: string | null;
  commission: number | null;
  cases: number;
}

/** Written PROTECTION commission per adviser over [from, to] — the other half of the commission
 *  league on Market Momentum, where `revenueByAdviser` above supplies the mortgage half.
 *
 *  Same basis as `momentum.protectionWrittenDaily` (ApplicationDate, cases at or beyond submission),
 *  deliberately: the league sits beside the Weekly Written graph and its rows must add up to the bar
 *  that graph plots for the same week. Do not change the basis here without changing it there — a
 *  league that does not sum to the chart next to it is precisely the "which number is right?" email
 *  this board exists to stop.
 *
 *  ⚠ PER-ADVISER protection cannot match the platform's Total Written Report while commission SPLITS
 *  are absent from the Gold share. The recipient of a split lives in `dbo.tblSplitCommission.ToAdviserId`,
 *  which we do not receive (PBI 91379), so a split case credits its primary adviser in full here while
 *  the platform divides it across two names. FIRM totals are unaffected, which is why the graph beside
 *  the league is on firmer ground than any single row of it. See SPLIT_RECIPIENT_SOURCE. */
export function protectionCommissionByAdviser(from: string, to: string): BuiltQuery {
  const where = combine(
    orgFilter("f"),
    notDeleted("f"),
    dateRange(`f.${PROTECTION_WRITTEN_DATE}`, from, to),
    { clause: `f.WorkflowStatusId IN (${PROTECTION_WRITTEN_STATUSES.map((s) => `'${s}'`).join(", ")})`, params: [] },
  );
  return {
    text: `SELECT adv.Username AS username, adv.FullName AS fullName,
                  SUM(COALESCE(f.ProductCommission, 0)) AS commission,
                  COUNT(*) AS cases
             FROM dbo.protectioncase f
             LEFT JOIN dbo.useraccount adv ON adv.UserAccountKey = f.PrimaryAdviserUserAccountKey
            ${whereClause(where)}
            GROUP BY adv.Username, adv.FullName;`,
    params: where.params,
  };
}
