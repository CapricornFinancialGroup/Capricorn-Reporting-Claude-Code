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
