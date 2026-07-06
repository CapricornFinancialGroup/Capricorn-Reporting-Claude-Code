// Funnel Health (screen 4) query builders.
//
// The funnel is SAME-WINDOW FLOW RATES (stage counts within the window, conversion = downstream ÷
// upstream), not cohort tracking — the strawman's semantics; the page caption says so.
//
// Stage note (verified live 2026-07-06): Capricorn's workflow meeting/DIP dates went dark after
// April 2026 (platform change), so the live mortgage progression is Leads → Applications (Written)
// → Offers (OfferIssueDate); the protection leg (Referrals via crosssellreferral → Sales via
// protectioncase) completes the five stages.
//
// "Open" case = written but not completed and not marked not-proceeding.

import { ALERT_THRESHOLDS } from "../../domain/targets.js";
import { combine, excludeMigrations, notDeleted, orgFilter, whereClause, type Fragment } from "./filters.js";
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

/** Open-case guard: written, not completed, not not-proceeding. */
function openCase(alias = "f"): Fragment {
  return {
    clause: `${alias}.CompletionDate IS NULL AND COALESCE(${alias}.NotProceedingYN, 'N') <> 'Y'`,
    params: [],
  };
}

export interface AgedApplications {
  agedCount: number;
  avgAgeDays: number | null;
  oldestDays: number | null;
}

/** Applications written ≥ threshold days before asOf with no lender offer yet, still open.
 *  Look-back bounded to 90 days so ancient stale rows don't dominate the wall. */
export function agedApplications(asOf: string): BuiltQuery {
  const where = combine(orgFilter("f"), notDeleted("f"), excludeMigrations("f"), openCase(), {
    clause: `f.WrittenDate >= DATEADD(day, -90, @AsOf)
             AND f.WrittenDate <= DATEADD(day, -@AgedDays, @AsOf)
             AND f.OfferIssueDate IS NULL`,
    params: [
      { name: "AsOf", value: asOf, kind: "date" },
      { name: "AgedDays", value: ALERT_THRESHOLDS.agedApplicationDays, kind: "int" },
    ],
  });
  return {
    text: `SELECT COUNT(*) AS agedCount,
                  AVG(DATEDIFF(day, f.WrittenDate, @AsOf)) AS avgAgeDays,
                  MAX(DATEDIFF(day, f.WrittenDate, @AsOf)) AS oldestDays
             FROM dbo.mortgagecase f
            ${whereClause(where)};`,
    params: where.params,
  };
}

export interface ActionQueues {
  callNow: number;
  followUp: number;
  chaseLender: number;
  /** Distinct leads with an application written this month (REFER NOW proxy denominator). */
  writtenLeads: number;
}

/** The four "cases awaiting action" queues, one pass over mortgagecase.
 *    CALL NOW      lead created 1+ days ago (30d window), nothing written yet
 *    FOLLOW UP     offer issued 7+ days ago (90d window), case not completed
 *    CHASE LENDER  application written 7+ days ago (90d window), no lender offer
 *    (REFER NOW is a flow proxy computed in the dataset layer — see note below.)
 */
export function actionQueues(asOf: string, monthStart: string): BuiltQuery {
  const base = combine(orgFilter("f"), notDeleted("f"), excludeMigrations("f"), openCase());
  const params: SqlParam[] = [
    ...base.params,
    { name: "AsOf", value: asOf, kind: "date" },
    { name: "MonthStart", value: monthStart, kind: "date" },
  ];
  return {
    text: `SELECT
             COUNT(DISTINCT CASE WHEN f.LeadDate >= DATEADD(day, -30, @AsOf) AND f.LeadDate <= DATEADD(day, -1, @AsOf)
                                  AND f.WrittenDate IS NULL
                                 THEN f.LeadId END) AS callNow,
             SUM(CASE WHEN f.OfferIssueDate >= DATEADD(day, -90, @AsOf) AND f.OfferIssueDate <= DATEADD(day, -7, @AsOf)
                      THEN 1 ELSE 0 END) AS followUp,
             SUM(CASE WHEN f.WrittenDate >= DATEADD(day, -90, @AsOf) AND f.WrittenDate <= DATEADD(day, -7, @AsOf)
                       AND f.OfferIssueDate IS NULL THEN 1 ELSE 0 END) AS chaseLender,
             COUNT(DISTINCT CASE WHEN f.WrittenDate >= @MonthStart AND f.WrittenDate <= @AsOf
                                 THEN f.LeadId END) AS writtenLeads
             FROM dbo.mortgagecase f
            WHERE ${base.clause};`,
    params,
  };
}

// NB there is deliberately NO case-level "which applications were referred" join: the share's
// crosssellreferral.CaseID does not resolve against any exported case table (verified live
// 2026-07-06 — 7/407 rows match mortgagecase, 0 match protectioncase). Until the share carries the
// referral→source-case link, the donut and REFER NOW queue are flow proxies computed in the dataset
// layer: referrals made vs applications written in the same window.

export interface PipelineSummary {
  inFlightCount: number;
  inFlightValue: number | null;
  avgCaseSize: number | null;
  revenueLatestDay: number | null;
}

/** Pipeline strip: open written cases (90d) value/size + estimated revenue on the latest day. */
export function pipelineSummary(asOf: string): BuiltQuery {
  const base = combine(orgFilter("f"), notDeleted("f"), excludeMigrations("f"));
  const params: SqlParam[] = [...base.params, { name: "AsOf", value: asOf, kind: "date" }];
  return {
    text: `SELECT
             SUM(CASE WHEN f.WrittenDate >= DATEADD(day, -90, @AsOf) AND f.WrittenDate <= @AsOf
                       AND f.CompletionDate IS NULL AND COALESCE(f.NotProceedingYN, 'N') <> 'Y'
                      THEN 1 ELSE 0 END) AS inFlightCount,
             SUM(CASE WHEN f.WrittenDate >= DATEADD(day, -90, @AsOf) AND f.WrittenDate <= @AsOf
                       AND f.CompletionDate IS NULL AND COALESCE(f.NotProceedingYN, 'N') <> 'Y'
                      THEN f.MortgageValue END) AS inFlightValue,
             AVG(CASE WHEN f.WrittenDate >= DATEADD(day, -90, @AsOf) AND f.WrittenDate <= @AsOf
                       AND f.CompletionDate IS NULL AND COALESCE(f.NotProceedingYN, 'N') <> 'Y'
                      THEN f.MortgageValue END) AS avgCaseSize,
             SUM(CASE WHEN f.WrittenDate = @AsOf
                      THEN COALESCE(f.NetCommission, f.ProductCommission, 0) + COALESCE(f.ClientFeeAmount, 0)
                      END) AS revenueLatestDay
             FROM dbo.mortgagecase f
            WHERE ${base.clause};`,
    params,
  };
}

export interface StageAges {
  leadAvgDays: number | null;
  applicationAvgDays: number | null;
  offerAvgDays: number | null;
}

/** Average days open cases have been sitting at each stage (90-day look-back). */
export function stageAges(asOf: string): BuiltQuery {
  const base = combine(orgFilter("f"), notDeleted("f"), excludeMigrations("f"), openCase());
  const params: SqlParam[] = [...base.params, { name: "AsOf", value: asOf, kind: "date" }];
  return {
    text: `SELECT
             AVG(CASE WHEN f.LeadDate >= DATEADD(day, -90, @AsOf) AND f.WrittenDate IS NULL
                      THEN DATEDIFF(day, f.LeadDate, @AsOf) END) AS leadAvgDays,
             AVG(CASE WHEN f.WrittenDate >= DATEADD(day, -90, @AsOf) AND f.OfferIssueDate IS NULL
                      THEN DATEDIFF(day, f.WrittenDate, @AsOf) END) AS applicationAvgDays,
             AVG(CASE WHEN f.OfferIssueDate >= DATEADD(day, -90, @AsOf)
                      THEN DATEDIFF(day, f.OfferIssueDate, @AsOf) END) AS offerAvgDays
             FROM dbo.mortgagecase f
            WHERE ${base.clause};`,
    params,
  };
}