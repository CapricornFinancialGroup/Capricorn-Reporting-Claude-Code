// Funnel Health (screen 4) query builders.
//
// The funnel is SAME-WINDOW FLOW RATES (stage counts within the window, conversion = downstream ÷
// upstream), not cohort tracking — the strawman's semantics; the page caption says so.
//
// Stage note (verified live 2026-07-06): Capricorn's workflow meeting/DIP dates went dark after
// April 2026 (platform change), so the live mortgage progression is Leads → Applications (Written)
// → Offers (OfferIssueDate); the protection leg (Referrals via crosssellreferral → Sales via
// protectioncase) completes the five stages.

import { combine, excludeMigrations, notDeleted, orgFilter } from "./filters.js";
import type { BuiltQuery, SqlParam } from "./query.js";

export interface MortgageStageCounts {
  leads: number;
  applications: number;
  offers: number;
}

/** Mortgage-side stage counts within [from, to] — one pass over mortgagecase. */
export function mortgageStageCounts(from: string, to: string): BuiltQuery {
  const base = combine(orgFilter("f"), notDeleted("f"), excludeMigrations("f"));
  const params: SqlParam[] = [
    ...base.params,
    { name: "From", value: from, kind: "date" },
    { name: "To", value: to, kind: "date" },
  ];
  return {
    text: `SELECT
             COUNT(DISTINCT CASE WHEN f.LeadDate >= @From AND f.LeadDate <= @To THEN f.LeadId END) AS leads,
             SUM(CASE WHEN f.WrittenDate >= @From AND f.WrittenDate <= @To THEN 1 ELSE 0 END) AS applications,
             SUM(CASE WHEN f.OfferIssueDate >= @From AND f.OfferIssueDate <= @To THEN 1 ELSE 0 END) AS offers
             FROM dbo.mortgagecase f
            WHERE ${base.clause};`,
    params,
  };
}

// NB there is deliberately NO case-level "which applications were referred" join: the share's
// crosssellreferral.CaseID does not resolve against any exported case table (verified live
// 2026-07-06 — 7/407 rows match mortgagecase, 0 match protectioncase). Until the share carries the
// referral→source-case link, the applications-vs-referrals gap chart (datasets.ts) is a flow proxy:
// referrals made vs applications written in the same window, not a per-case join.