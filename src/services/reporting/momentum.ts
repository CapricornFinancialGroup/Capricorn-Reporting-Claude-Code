// Market Momentum (screen 5) — daily revenue/value rows the dataset layer buckets into Sat–Fri
// reporting weeks in TS (weekStartOf from trends.ts), so the SQL stays trivially portable.

import { combine, excludeMigrations, dateRange, notDeleted, orgFilter, whereClause } from "./filters.js";
import type { BuiltQuery } from "./query.js";

export interface RevenueDaily {
  d: string;
  revenue: number | null;
  totalValue: number | null;
  cases: number;
}

/** Daily written revenue (indicative commission+fees), total mortgage value and case count. */
export function revenueDaily(from: string, to: string): BuiltQuery {
  const where = combine(orgFilter("f"), notDeleted("f"), excludeMigrations("f"), dateRange("f.WrittenDate", from, to));
  return {
    text: `SELECT CAST(f.WrittenDate AS date) AS d,
                  SUM(COALESCE(f.NetCommission, f.ProductCommission, 0) + COALESCE(f.ClientFeeAmount, 0)) AS revenue,
                  SUM(f.MortgageValue) AS totalValue,
                  COUNT(*) AS cases
             FROM dbo.mortgagecase f
            ${whereClause(where)}
            GROUP BY CAST(f.WrittenDate AS date)
            ORDER BY d;`,
    params: where.params,
  };
}

export interface WrittenByProductDaily {
  d: string;
  mortgageWritten: number | null;
  insuranceWritten: number | null;
}

/** Daily WRITTEN business £ by product, from `vw_total_written_by_product` — the pre-built view that
 *  backs Capricorn's own Total Written report (docs/data-dictionary.md). Sourcing the dashboard's
 *  "Revenue" actual from here means it reconciles to that report by construction (Kyle 2026-07-14).
 *  "Insurance" = ProtectionWritten (protection); GI (BuildingsContentsWritten) is excluded — there's
 *  no GI target. The view is pre-aggregated (no DeletedYN / no LeadDate), so only org + WrittenDate
 *  scoping applies.
 *
 *  ⚠ Ships UNVALIDATED against the live lake (Luke authorised 2026-07-14): the view's column names /
 *  population — ProtectionWritten especially — have not been checked against real data. Sanity-check
 *  the numbers on the board immediately after deploy. */
export function writtenByProductDaily(from: string, to: string): BuiltQuery {
  const where = combine(orgFilter("f"), dateRange("f.WrittenDate", from, to));
  return {
    text: `SELECT CAST(f.WrittenDate AS date) AS d,
                  SUM(f.MortgageWritten) AS mortgageWritten,
                  SUM(f.ProtectionWritten) AS insuranceWritten
             FROM dbo.vw_total_written_by_product f
            ${whereClause(where)}
            GROUP BY CAST(f.WrittenDate AS date)
            ORDER BY d;`,
    params: where.params,
  };
}
