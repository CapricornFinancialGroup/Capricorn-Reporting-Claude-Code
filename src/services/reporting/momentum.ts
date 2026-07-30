// Market Momentum (screen 5) — daily revenue/value rows the dataset layer buckets into Sat–Fri
// reporting weeks in TS (weekStartOf from trends.ts), so the SQL stays trivially portable.

import { MORTGAGE_WRITTEN_DATE, PROTECTION_WRITTEN_DATE } from "../../domain/data-quality.js";
import { combine, dateRange, notDeleted, orgFilter, whereClause } from "./filters.js";
import type { BuiltQuery } from "./query.js";

export interface RevenueDaily {
  d: string;
  /** Written mortgage COMMISSION only — the basis Capricorn's Total Written report uses. */
  commission: number | null;
  /** Client fees, carried separately: they are not commission, so they must not silently inflate
   *  "Written". Est. Revenue (Adviser League) adds them back; Weekly Written does not. */
  clientFees: number | null;
  totalValue: number | null;
  cases: number;
}

/** Daily written mortgage commission, client fees, loan value and case count.
 *
 *  NOTE no migration guard: it keys on LeadDate and was deleting genuine written business here
 *  (16 cases / £19,592 in July) — see excludeMigrations in filters.ts.
 *
 *  Verified against the live lake 2026-07-29: NetCommission, ProductCommission and
 *  ActualCommissionPaid hold the SAME value on every Capricorn row, so the COALESCE chain is a
 *  no-op today; it's kept only as a guard for rows where NetCommission is genuinely null. */
export function revenueDaily(from: string, to: string): BuiltQuery {
  const where = combine(orgFilter("f"), notDeleted("f"), dateRange(`f.${MORTGAGE_WRITTEN_DATE}`, from, to));
  return {
    text: `SELECT CAST(f.${MORTGAGE_WRITTEN_DATE} AS date) AS d,
                  SUM(COALESCE(f.NetCommission, f.ProductCommission, 0)) AS commission,
                  SUM(COALESCE(f.ClientFeeAmount, 0)) AS clientFees,
                  SUM(f.MortgageValue) AS totalValue,
                  COUNT(*) AS cases
             FROM dbo.mortgagecase f
            ${whereClause(where)}
            GROUP BY CAST(f.${MORTGAGE_WRITTEN_DATE} AS date)
            ORDER BY d;`,
    params: where.params,
  };
}

export interface ProtectionWrittenDaily {
  d: string;
  commission: number | null;
  cases: number;
}

/** Daily written PROTECTION commission — the other half of "written business".
 *
 *  Momentum's insurance actual was hardcoded to £0 until 2026-07-29, so "Weekly Written" was
 *  mortgage-only while Capricorn's own Total Written report is mortgage + protection. This is the
 *  closest populated lake source: `protectioncase.ProductCommission` by WrittenDate, which yields
 *  ~£21.8k (W29) / ~£24.3k (W30). Kyle has previously quoted ~£41k/wk — the discrepancy is an OPEN
 *  question with him, so the board labels this figure indicative until he confirms the basis. */
export function protectionWrittenDaily(from: string, to: string): BuiltQuery {
  const where = combine(orgFilter("f"), notDeleted("f"), dateRange(`f.${PROTECTION_WRITTEN_DATE}`, from, to));
  return {
    text: `SELECT CAST(f.${PROTECTION_WRITTEN_DATE} AS date) AS d,
                  SUM(COALESCE(f.ProductCommission, 0)) AS commission,
                  COUNT(*) AS cases
             FROM dbo.protectioncase f
            ${whereClause(where)}
            GROUP BY CAST(f.${PROTECTION_WRITTEN_DATE} AS date)
            ORDER BY d;`,
    params: where.params,
  };
}

// REMOVED 2026-07-29 — `writtenByProductDaily`, which read `vw_total_written_by_product` on the
// assumption that its MortgageWritten/ProtectionWritten columns were COMMISSION and would therefore
// "reconcile to Capricorn's Total Written report by construction". Both assumptions are false,
// verified against the live lake:
//
//   • `MortgageWritten` is LOAN VALUE. It equals SUM(mortgagecase.MortgageValue) to the penny on
//     11, 12, 18, 24, 26 and 29 Jul 2026, and its row-level values are round loan amounts
//     (860,000 / 630,926 / 499,316).
//   • `ProtectionWritten` is POLICY AMOUNT (254,350 / 541,500 = protectioncase.ProtectionPolicyAmount).
//
// Wiring it in would have put ~£11.8m on the board where Kyle's report reads £112k. The view is
// never the written-commission source; use revenueDaily + protectionWrittenDaily above.
