// Live-feed ticker — real events over a short WINDOW ending today, newest day first.
//
// It was one day at a time, chosen by `liveFeed` as "today if today has anything, else the last
// working day". That produced the thing Capricorn objected to on 2026-08-25: at 06:30 on a Tuesday
// today holds almost nothing (the ~06:00 load carries ~1.5% of a day), so the whole strip fell back
// to Monday and the wall carried a date stamp reading yesterday. "Just have a ticker running across …
// so that people can see activity happening."
//
// A window fixes the cause rather than the label. Each query takes the newest days first and stops
// when it has filled its quota, so a busy afternoon shows only today and a quiet morning reaches back
// a day for company — with no fallback branch, and no moment where the strip is empty or stale-looking.
// The day travels with each ROW so an item that is not from today can say so itself; the header no
// longer speaks for the whole strip.
//
// PII rule: adviser names, lenders, introducer companies and £ values only — the ticker NEVER
// joins the client table (no client PII on an office wall).

import { MORTGAGE_WRITTEN_DATE } from "../../domain/data-quality.js";
import { combine, excludeMigrations, notDeleted, orgFilter } from "./filters.js";
import { CLIENT_FIRST_CASE_CTE } from "./kpis.js";
import type { BuiltQuery, SqlParam } from "./query.js";

/** Every ticker row carries the day it belongs to, so the strip can label it rather than the header
 *  labelling everything. */
export interface TickerEvent {
  day: unknown;
}

const cap = (top: number) => Math.max(1, Math.min(100, top));

/** `from`/`to` inclusive. Both are business dates (YYYY-MM-DD) in the reporting timezone. */
function windowParams(from: string, to: string, base: { params: SqlParam[] }): SqlParam[] {
  return [...base.params, { name: "F", value: from, kind: "date" }, { name: "T", value: to, kind: "date" }];
}

export interface ApplicationEvent extends TickerEvent {
  fullName: string | null;
  username: string | null;
  mortgageValue: number | null;
  lenderName: string | null;
}

export function applicationEvents(from: string, to: string, top = 25): BuiltQuery {
  // No migration guard (LeadDate-keyed — it was dropping genuine written cases) and the window keys on
  // MORTGAGE_WRITTEN_DATE so the ticker names the same events the KPI counts.
  const base = combine(orgFilter("f"), notDeleted("f"));
  return {
    text: `SELECT TOP ${cap(top)}
                  adv.FullName AS fullName, adv.Username AS username,
                  f.MortgageValue AS mortgageValue, l.LenderName AS lenderName,
                  CAST(f.${MORTGAGE_WRITTEN_DATE} AS date) AS day
             FROM dbo.mortgagecase f
             LEFT JOIN dbo.useraccount adv ON adv.UserAccountKey = f.PrimaryAdviserUserAccountKey
             LEFT JOIN dbo.lender l ON l.LenderKey = f.LenderKey
            WHERE ${base.clause} AND f.${MORTGAGE_WRITTEN_DATE} BETWEEN @F AND @T
            ORDER BY day DESC, f.MortgageValue DESC;`,
    params: windowParams(from, to, base),
  };
}

export interface LeadEvent extends TickerEvent {
  fullName: string | null;
  username: string | null;
  introducer: string | null;
}

/** New-client lead events. Restricted to first-case clients so the ticker names the same events the
 *  Leads KPI counts — a ticker announcing "new lead" for a remortgage of a ten-year client would
 *  contradict the tile above it (Capricorn 2026-08-17, see NEW_CLIENT_LEAD_BASIS). Still no client-table
 *  join: the PII rule above is unaffected, `PrimaryClientKey` is a bare key. */
export function leadEvents(from: string, to: string, top = 25): BuiltQuery {
  const base = combine(orgFilter("f"), notDeleted("f"), excludeMigrations("f"));
  return {
    text: `WITH ${CLIENT_FIRST_CASE_CTE}
           SELECT TOP ${cap(top)}
                  adv.FullName AS fullName, adv.Username AS username,
                  CASE WHEN COALESCE(i.IntroducerIsMainBrokerageYN, 'N') = 'Y' THEN NULL
                       ELSE i.IntroducerCompany END AS introducer,
                  CAST(f.LeadDate AS date) AS day
             FROM dbo.mortgagecase f
             LEFT JOIN clientFirstCase fc ON fc.ck = f.PrimaryClientKey
             LEFT JOIN dbo.useraccount adv ON adv.UserAccountKey = f.PrimaryAdviserUserAccountKey
             LEFT JOIN dbo.introducer i ON i.IntroducerKey = f.IntroducerKey
            WHERE ${base.clause} AND f.LeadDate BETWEEN @F AND @T
              AND (fc.firstDay IS NULL OR fc.firstDay >= f.LeadDate)
            ORDER BY day DESC, f.LeadId DESC;`,
    params: windowParams(from, to, base),
  };
}

export interface ReferralEvent extends TickerEvent {
  fullName: string | null;
  username: string | null;
}

export function referralEvents(from: string, to: string, top = 25): BuiltQuery {
  // Protection OPPORTUNITIES — protection cases opened in the window. Was crosssellreferral
  // (PaymentShield quotes + currency exchange, not protection at all) until 2026-07-30; see
  // PROTECTION_OPPORTUNITY_NOTE in domain/data-quality.ts.
  const base = combine(orgFilter("f"), notDeleted("f"));
  return {
    text: `SELECT TOP ${cap(top)}
                  adv.FullName AS fullName, adv.Username AS username,
                  CAST(f.CreatedDate AS date) AS day
             FROM dbo.protectioncase f
             LEFT JOIN dbo.useraccount adv ON adv.UserAccountKey = f.PrimaryAdviserUserAccountKey
            WHERE ${base.clause} AND f.CreatedDate BETWEEN @F AND @T
            ORDER BY day DESC, f.ProtectionPolicyAmount DESC;`,
    params: windowParams(from, to, base),
  };
}

export interface SaleEvent extends TickerEvent {
  fullName: string | null;
  username: string | null;
  policyAmount: number | null;
}

export function saleEvents(from: string, to: string, top = 25): BuiltQuery {
  // protectioncase has no LeadDate — the migration guard (mortgagecase-only) doesn't apply here.
  const base = combine(orgFilter("f"), notDeleted("f"));
  return {
    text: `SELECT TOP ${cap(top)}
                  adv.FullName AS fullName, adv.Username AS username, f.ProtectionPolicyAmount AS policyAmount,
                  CAST(f.WrittenDate AS date) AS day
             FROM dbo.protectioncase f
             LEFT JOIN dbo.useraccount adv ON adv.UserAccountKey = f.PrimaryAdviserUserAccountKey
            WHERE ${base.clause} AND f.WrittenDate BETWEEN @F AND @T
            ORDER BY day DESC, f.ProtectionPolicyAmount DESC;`,
    params: windowParams(from, to, base),
  };
}
