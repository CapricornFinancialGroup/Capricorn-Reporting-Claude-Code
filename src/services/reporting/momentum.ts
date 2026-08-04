// Market Momentum (screen 5) — daily revenue/value rows the dataset layer buckets into Sat–Fri
// reporting weeks in TS (weekStartOf from trends.ts), so the SQL stays trivially portable.

import { MORTGAGE_WRITTEN_DATE, PROTECTION_WRITTEN_DATE, PROTECTION_WRITTEN_STATUSES } from "../../domain/data-quality.js";
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
 *  Commission is `ProductCommission` — the column Capricorn's own report sums (`F.commission` in
 *  usp_GetFinancialProductReport). It was COALESCE(NetCommission, ProductCommission) until
 *  2026-08-04, on a 2026-07-29 check that found the two identical on every row. They are no longer:
 *  for Sat 25-31 Jul they differ on 1 of 222 cases, £413,380.51 gross vs £411,841.61 net. Tiny, but
 *  it is a stray difference against their report with no story behind it, which is exactly what
 *  generates the emails — so match the platform column and stop guessing. */
export function revenueDaily(from: string, to: string): BuiltQuery {
  const where = combine(orgFilter("f"), notDeleted("f"), dateRange(`f.${MORTGAGE_WRITTEN_DATE}`, from, to));
  return {
    text: `SELECT CAST(f.${MORTGAGE_WRITTEN_DATE} AS date) AS d,
                  SUM(COALESCE(f.ProductCommission, 0)) AS commission,
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
 *  mortgage-only while Capricorn's own Total Written report is mortgage + protection.
 *
 *  Now on Capricorn's own basis and RECONCILED: ApplicationDate, cases at or beyond submission, which
 *  gives £68,951 for Sat 25-31 Jul against the c.£69K Kyle quoted. The old WrittenDate basis gave
 *  £48,969 and drove my wrong "£400k would disappear" warning — see PROTECTION_WRITTEN_DATE in
 *  domain/data-quality.ts for what that error actually was. */
export function protectionWrittenDaily(from: string, to: string): BuiltQuery {
  const where = combine(
    orgFilter("f"),
    notDeleted("f"),
    dateRange(`f.${PROTECTION_WRITTEN_DATE}`, from, to),
    { clause: `f.WorkflowStatusId IN (${PROTECTION_WRITTEN_STATUSES.map((s) => `'${s}'`).join(", ")})`, params: [] },
  );
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
