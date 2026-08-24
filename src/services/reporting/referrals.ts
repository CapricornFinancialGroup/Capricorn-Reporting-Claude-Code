// Crediting a protection sale back to the mortgage adviser who introduced the client.
//
// WHY THIS IS DERIVED RATHER THAN READ. Capricorn's 60/40 split pays the referring mortgage adviser,
// and the platform records the recipient in `tblSplitCommission.ToAdviserId`. That table is not in
// the Gold share (PBI 91379), and even in the platform it covers only 24 of 718 protection cases in
// 90 days. The two fields our feed does carry are no use either: `SplitAdviserUserAccountKey` is
// NULL on every split case, and `ReferringAdviserUserAccountKey` holds a firm-level sentinel (the
// negated OrganisationKey, e.g. -486) on 23 of those 24. `protectioncase.LeadId` looks promising and
// is not — it and `mortgagecase.LeadId` are separate key spaces, overlapping on 63 rows table-wide
// and on ZERO of the 90 protection sales in a recent 4-week window.
//
// What does work is the CLIENT. Where a protection case's primary client also holds a mortgage case,
// the adviser on that mortgage introduced them. Measured over 18 Jul – 14 Aug 2026: 90 written
// protection cases, 78 whose client also has a mortgage, and 76 where that mortgage adviser is
// someone OTHER than the protection adviser — 84% attribution, against 3% for the split table.
//
// ⚠ IT IS AN INFERENCE, NOT A RECORD, and every screen that uses it must say so. It answers "whose
// client was this?", which is not quite "who made the referral?", and it will not always agree with
// the Written Report, which pays on ToAdviserId. Sound for a management conversation; NOT sound as a
// basis for paying commission. When 91379 lands, compare the two and either confirm this or drop it.

import { PROTECTION_WRITTEN_DATE, PROTECTION_WRITTEN_STATUSES } from "../../domain/data-quality.js";
import { combine, dateRange, notDeleted, orgFilter, whereClause } from "./filters.js";
import type { BuiltQuery } from "./query.js";

export interface ReferredSale {
  /** Login of the mortgage adviser whose client this was. Null when the client has no mortgage. */
  originator: string | null;
  originatorName: string | null;
  /** Login of the protection adviser who wrote the policy. */
  converter: string | null;
  converterName: string | null;
  sales: number;
  /** FULL policy commission — 100%, before Capricorn's 60/40 is applied. */
  commission: number | null;
  /**
   * The 40% the platform has already carved out for the referring mortgage adviser.
   *
   * This is READ, not computed: `protectioncase.SplitCommission` is exactly 40% of ProductCommission
   * on every split case (verified across all 102 split cases in the 90 days to 2026-08-21). So the
   * MONEY is Capricorn's own figure; only the RECIPIENT is the inference above. Null/zero on cases
   * carrying no split at all, where the writing adviser keeps the whole commission.
   */
  splitCommission: number | null;
}

/**
 * Written protection sales in the window, paired to the introducing mortgage adviser via the client.
 *
 * Rows where originator IS NULL are sales whose client we cannot tie to a mortgage — kept rather than
 * filtered so the screen can show honest coverage ("76 of 90 attributed") instead of quietly
 * shrinking the denominator.
 *
 * Self-referrals (the protection adviser is also the mortgage adviser) are returned too and excluded
 * in TS, so the same query can answer "how much of this did they source themselves?".
 */
export function referredProtectionSales(from: string, to: string): BuiltQuery {
  const where = combine(
    orgFilter("p"),
    notDeleted("p"),
    dateRange(`p.${PROTECTION_WRITTEN_DATE}`, from, to),
    { clause: `p.WorkflowStatusId IN (${PROTECTION_WRITTEN_STATUSES.map((s) => `'${s}'`).join(", ")})`, params: [] },
  );
  return {
    text: `SELECT originator     = mu.Username,
                  originatorName = mu.FullName,
                  converter      = pu.Username,
                  converterName  = pu.FullName,
                  sales          = COUNT(*),
                  commission     = SUM(COALESCE(p.ProductCommission, 0)),
                  splitCommission = SUM(COALESCE(p.SplitCommission, 0))
             FROM dbo.protectioncase p
             LEFT JOIN dbo.protectioncaseclient pc
                    ON pc.GlobalCaseID = p.GlobalCaseID
                   AND COALESCE(pc.PrimaryClientYN, 'N') = 'Y'
             -- The earliest mortgage on that client: the adviser who brought them in, not whoever
             -- happened to write their most recent product.
             OUTER APPLY (SELECT TOP 1 m.PrimaryAdviserUserAccountKey
                            FROM dbo.mortgagecase m
                           WHERE m.PrimaryClientKey = pc.ClientKey
                             AND COALESCE(m.DeletedYN, 'N') <> 'Y'
                           ORDER BY m.LeadDate) mc
             LEFT JOIN dbo.useraccount mu ON mu.UserAccountKey = mc.PrimaryAdviserUserAccountKey
             LEFT JOIN dbo.useraccount pu ON pu.UserAccountKey = p.PrimaryAdviserUserAccountKey
            ${whereClause(where)}
            GROUP BY mu.Username, mu.FullName, pu.Username, pu.FullName;`,
    params: where.params,
  };
}
