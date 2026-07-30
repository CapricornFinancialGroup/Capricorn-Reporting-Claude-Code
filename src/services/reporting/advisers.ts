// Adviser League (screen 3) query builders — per-adviser revenue; the per-adviser KPI counts come
// from kpis.kpiDailyByAdviser so the league always agrees with the run-chase screens.

import { MORTGAGE_WRITTEN_DATE } from "../../domain/data-quality.js";
import { combine, dateRange, notDeleted, orgFilter, whereClause } from "./filters.js";
import type { BuiltQuery } from "./query.js";

export interface AdviserRevenue {
  username: string | null;
  fullName: string | null;
  commission: number | null;
  clientFees: number | null;
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
 *  No migration guard: it keys on LeadDate and was deleting genuine written business — see
 *  excludeMigrations in filters.ts. */
export function revenueByAdviser(from: string, to: string): BuiltQuery {
  const where = combine(orgFilter("f"), notDeleted("f"), dateRange(`f.${MORTGAGE_WRITTEN_DATE}`, from, to));
  return {
    text: `SELECT adv.Username AS username, adv.FullName AS fullName,
                  SUM(COALESCE(f.NetCommission, f.ProductCommission, 0)) AS commission,
                  SUM(COALESCE(f.ClientFeeAmount, 0)) AS clientFees
             FROM dbo.mortgagecase f
             LEFT JOIN dbo.useraccount adv ON adv.UserAccountKey = f.PrimaryAdviserUserAccountKey
            ${whereClause(where)}
            GROUP BY adv.Username, adv.FullName;`,
    params: where.params,
  };
}
