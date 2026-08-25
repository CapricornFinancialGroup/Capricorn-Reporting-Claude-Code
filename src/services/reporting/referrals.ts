// Crediting a protection sale back to the mortgage adviser who introduced the client.
//
// READ FIRST, DERIVED ONLY AS A FALLBACK — corrected 2026-08-25.
//
// This file used to say the recipient was unavailable and that the derivation was the only option.
// That was wrong, and it is the claim we put to Kyle four times. `protectioncase.SplitAdviserUserAccountKey`
// IS in the share and carries `tblSplitCommission.ToAdviserId` resolved through `useraccount`; it is
// populated on 100% of split cases merged up to June 2026 and empty on recent ones only because of an
// upstream regression. See SPLIT_RECIPIENT_SOURCE in domain/data-quality.ts for the evidence and for
// why PBI 91379 is the wrong ticket.
//
// How wrong the derivation was, measured over the 3,031 split cases where the platform names someone:
// it agreed on 511, named a DIFFERENT adviser on 159, and found nobody at all on 2,361. Right on 17%.
// In 2026 money that is £45,882 credited to the wrong adviser and £18,101 dropped to "no adviser on
// file", out of £193,647 of split commission.
//
// So the query prefers the platform's key (guarded `> 0`, because an unresolved key arrives as the
// negated OrganisationKey and would otherwise credit a blank account) and falls back to the client
// derivation below. `protectioncase.LeadId` remains a dead end — it and `mortgagecase.LeadId` are
// separate key spaces, overlapping on 63 rows table-wide and on ZERO of the 90 protection sales in a
// recent 4-week window.
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
  /**
   * Where the RECIPIENT came from: `"platform"` = Capricorn's own recorded split adviser,
   * `"derived"` = inferred from the client's earliest mortgage.
   *
   * Worth surfacing because the two disagree a lot. Measured 2026-08-25 over the 3,031 split cases
   * where the platform names a recipient: our derived method agreed on 511, named a DIFFERENT adviser
   * on 159, and found nobody at all on 2,361 — so it was right on 17%. In 2026-to-date money, £45,882
   * of split commission was credited to the wrong adviser and £18,101 fell to "no adviser on file",
   * out of £193,647. Preferring the platform's own field fixes all of that where it is populated.
   */
  originatorSource: "platform" | "derived" | null;
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
    // THE PLATFORM'S OWN RECIPIENT FIRST, ours only as a fallback.
    //
    // `protectioncase.SplitAdviserUserAccountKey` is the platform's answer — it maps
    // `tblSplitCommission.ToAdviserId` through `useraccount`. We told Kyle four times it was absent
    // from the share. It is not: it is a real column, populated on 100% of split cases up to April
    // 2026 (2,980 of them), and the reason recent cases read empty is an upstream regression, not a
    // missing field. He was right to keep pushing.
    //
    // `> 0` is not defensive noise. The Gold build writes `COALESCE(key, -OrganisationKey)`, so an
    // unresolved key arrives as −486 rather than NULL — a value that passes IS NOT NULL and names
    // nobody. Testing for a VALID MEMBER is the only honest check on any dimension key in this share.
    //
    // The fallback stays because the platform's field is currently empty on cases merged since July.
    // Preferring the field costs nothing while it is empty and starts paying the moment the upstream
    // build is fixed, with no further change here.
    text: `SELECT originator       = s.originator,
                  originatorName   = s.originatorName,
                  originatorSource = s.originatorSource,
                  converter        = s.converter,
                  converterName    = s.converterName,
                  sales            = COUNT(*),
                  commission       = SUM(s.productCommission),
                  splitCommission  = SUM(s.splitCommission)
             FROM (
               SELECT originator       = COALESCE(sa.Username, mu.Username),
                      originatorName   = COALESCE(sa.FullName, mu.FullName),
                      originatorSource = CASE WHEN sa.UserAccountKey IS NOT NULL THEN 'platform'
                                              WHEN mu.UserAccountKey IS NOT NULL THEN 'derived'
                                              ELSE NULL END,
                      converter        = pu.Username,
                      converterName    = pu.FullName,
                      productCommission = COALESCE(p.ProductCommission, 0),
                      splitCommission   = COALESCE(p.SplitCommission, 0)
                 FROM dbo.protectioncase p
                 -- Capricorn's own recorded recipient of the 40%. Sentinel keys (≤ 0) excluded here,
                 -- so an unresolved one falls through to the derivation instead of crediting nobody.
                 LEFT JOIN dbo.useraccount sa
                        ON sa.UserAccountKey = p.SplitAdviserUserAccountKey
                       AND p.SplitAdviserUserAccountKey > 0
                 LEFT JOIN dbo.protectioncaseclient pc
                        ON pc.GlobalCaseID = p.GlobalCaseID
                       AND COALESCE(pc.PrimaryClientYN, 'N') = 'Y'
                 -- The earliest mortgage on that client: the adviser who brought them in, not whoever
                 -- happened to write their most recent product. Only consulted when the platform has
                 -- not named a recipient.
                 OUTER APPLY (SELECT TOP 1 m.PrimaryAdviserUserAccountKey
                                FROM dbo.mortgagecase m
                               WHERE m.PrimaryClientKey = pc.ClientKey
                                 AND COALESCE(m.DeletedYN, 'N') <> 'Y'
                               ORDER BY m.LeadDate) mc
                 LEFT JOIN dbo.useraccount mu ON mu.UserAccountKey = mc.PrimaryAdviserUserAccountKey
                 LEFT JOIN dbo.useraccount pu ON pu.UserAccountKey = p.PrimaryAdviserUserAccountKey
                ${whereClause(where)}
             ) s
            GROUP BY s.originator, s.originatorName, s.originatorSource, s.converter, s.converterName;`,
    params: where.params,
  };
}
