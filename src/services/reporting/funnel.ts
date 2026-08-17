// Funnel Health (screen 4) query builders.
//
// The funnel is SAME-WINDOW FLOW RATES (stage counts within the window, conversion = downstream ÷
// upstream), not cohort tracking — the strawman's semantics; the page caption says so.
//
// Stage note (verified live 2026-07-06): Capricorn's workflow meeting/DIP dates went dark after
// April 2026 (platform change), so the live mortgage progression is Leads → Applications (Written)
// → Offers (the status-100 date — NOT OfferIssueDate, which is 97% empty; see MORTGAGE_OFFER_DATE);
// the protection leg (Opportunities = protectioncase opened → Sales = protectioncase written)
// completes the five stages.

import { MORTGAGE_OFFER_DATE, MORTGAGE_WRITTEN_DATE } from "../../domain/data-quality.js";
import { combine, excludeMigrations, notDeleted, orgFilter } from "./filters.js";
import { CLIENT_FIRST_CASE_CTE } from "./kpis.js";
import type { BuiltQuery, SqlParam } from "./query.js";

export interface MortgageStageCounts {
  leads: number;
  existingCases: number;
  applications: number;
  offers: number;
}

/** Mortgage-side stage counts within [from, to] — one pass over mortgagecase.
 *
 *  The migration guard sits INSIDE the leads expression, not in the WHERE: the batch is mis-dated
 *  on LeadDate only, so excluding it firm-wide also deleted genuine written applications and offers
 *  (see excludeMigrations' warning in filters.ts).
 *
 *  The funnel's mouth is NEW CLIENTS (Capricorn 2026-08-17), the same definition the run chase uses —
 *  the two screens must not disagree about what a lead is. Existing-client cases are returned
 *  alongside so the page can show the work that enters the pipeline without being new lead flow;
 *  they are NOT added into the leads stage. See NEW_CLIENT_LEAD_BASIS in domain/data-quality.ts. */
export function mortgageStageCounts(from: string, to: string): BuiltQuery {
  const base = combine(orgFilter("f"), notDeleted("f"));
  const mig = excludeMigrations("f");
  // Guard applies to the LeadDate-keyed stage only; empty when there's nothing to exclude.
  const leadGuard = mig.clause ? ` AND (${mig.clause})` : "";
  const inWindow = `f.LeadDate >= @From AND f.LeadDate <= @To${leadGuard}`;
  const isNewClient = "(fc.firstDay IS NULL OR fc.firstDay >= f.LeadDate)";
  const params: SqlParam[] = [
    ...base.params,
    ...mig.params,
    { name: "From", value: from, kind: "date" },
    { name: "To", value: to, kind: "date" },
  ];
  return {
    text: `WITH ${CLIENT_FIRST_CASE_CTE}
           SELECT
             COUNT(DISTINCT CASE WHEN ${inWindow} AND ${isNewClient} THEN f.PrimaryClientKey END) AS leads,
             SUM(CASE WHEN ${inWindow} AND fc.firstDay < f.LeadDate THEN 1 ELSE 0 END) AS existingCases,
             SUM(CASE WHEN f.${MORTGAGE_WRITTEN_DATE} >= @From AND f.${MORTGAGE_WRITTEN_DATE} <= @To THEN 1 ELSE 0 END) AS applications,
             SUM(CASE WHEN f.${MORTGAGE_OFFER_DATE} >= @From AND f.${MORTGAGE_OFFER_DATE} <= @To THEN 1 ELSE 0 END) AS offers
             FROM dbo.mortgagecase f
             LEFT JOIN clientFirstCase fc ON fc.ck = f.PrimaryClientKey
            WHERE ${base.clause};`,
    params,
  };
}

// NB there is deliberately NO case-level "which applications were referred" join: the share's
// crosssellreferral.CaseID does not resolve against any exported case table (verified live
// 2026-07-06 — 7/407 rows match mortgagecase, 0 match protectioncase). Until the share carries the
// referral→source-case link, the applications-vs-referrals gap chart (datasets.ts) is a flow proxy:
// referrals made vs applications written in the same window, not a per-case join.