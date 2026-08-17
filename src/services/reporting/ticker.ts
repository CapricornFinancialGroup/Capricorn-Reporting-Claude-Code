// Live-feed ticker — real events from the latest complete day in the lake.
//
// PII rule: adviser names, lenders, introducer companies and £ values only — the ticker NEVER
// joins the client table (no client PII on an office wall).

import { MORTGAGE_WRITTEN_DATE } from "../../domain/data-quality.js";
import { combine, excludeMigrations, notDeleted, orgFilter } from "./filters.js";
import { CLIENT_FIRST_CASE_CTE } from "./kpis.js";
import type { BuiltQuery, SqlParam } from "./query.js";

export interface ApplicationEvent {
  fullName: string | null;
  username: string | null;
  mortgageValue: number | null;
  lenderName: string | null;
}

export function applicationEvents(day: string, top = 25): BuiltQuery {
  // No migration guard (LeadDate-keyed — it was dropping genuine written cases) and the day keys on
  // MORTGAGE_WRITTEN_DATE so the ticker names the same events the KPI counts.
  const base = combine(orgFilter("f"), notDeleted("f"));
  const params: SqlParam[] = [...base.params, { name: "D", value: day, kind: "date" }];
  return {
    text: `SELECT TOP ${Math.max(1, Math.min(100, top))}
                  adv.FullName AS fullName, adv.Username AS username,
                  f.MortgageValue AS mortgageValue, l.LenderName AS lenderName
             FROM dbo.mortgagecase f
             LEFT JOIN dbo.useraccount adv ON adv.UserAccountKey = f.PrimaryAdviserUserAccountKey
             LEFT JOIN dbo.lender l ON l.LenderKey = f.LenderKey
            WHERE ${base.clause} AND f.${MORTGAGE_WRITTEN_DATE} = @D
            ORDER BY f.MortgageValue DESC;`,
    params,
  };
}

export interface LeadEvent {
  fullName: string | null;
  username: string | null;
  introducer: string | null;
}

/** New-client lead events for the day. Restricted to first-case clients so the ticker names the same
 *  events the Leads KPI counts — a ticker announcing "new lead" for a remortgage of a ten-year client
 *  would contradict the tile above it (Capricorn 2026-08-17, see NEW_CLIENT_LEAD_BASIS). Still no
 *  client-table join: the PII rule above is unaffected, `PrimaryClientKey` is a bare key. */
export function leadEvents(day: string, top = 25): BuiltQuery {
  const base = combine(orgFilter("f"), notDeleted("f"), excludeMigrations("f"));
  const params: SqlParam[] = [...base.params, { name: "D", value: day, kind: "date" }];
  return {
    text: `WITH ${CLIENT_FIRST_CASE_CTE}
           SELECT TOP ${Math.max(1, Math.min(100, top))}
                  adv.FullName AS fullName, adv.Username AS username,
                  CASE WHEN COALESCE(i.IntroducerIsMainBrokerageYN, 'N') = 'Y' THEN NULL
                       ELSE i.IntroducerCompany END AS introducer
             FROM dbo.mortgagecase f
             LEFT JOIN clientFirstCase fc ON fc.ck = f.PrimaryClientKey
             LEFT JOIN dbo.useraccount adv ON adv.UserAccountKey = f.PrimaryAdviserUserAccountKey
             LEFT JOIN dbo.introducer i ON i.IntroducerKey = f.IntroducerKey
            WHERE ${base.clause} AND f.LeadDate = @D
              AND (fc.firstDay IS NULL OR fc.firstDay >= f.LeadDate)
            ORDER BY f.LeadId DESC;`,
    params,
  };
}

export interface ReferralEvent {
  fullName: string | null;
  username: string | null;
}

export function referralEvents(day: string, top = 25): BuiltQuery {
  // Protection OPPORTUNITIES — protection cases opened on the day. Was crosssellreferral (PaymentShield
  // quotes + currency exchange, not protection at all) until 2026-07-30; see
  // PROTECTION_OPPORTUNITY_NOTE in domain/data-quality.ts.
  const base = combine(orgFilter("f"), notDeleted("f"));
  const params: SqlParam[] = [...base.params, { name: "D", value: day, kind: "date" }];
  return {
    text: `SELECT TOP ${Math.max(1, Math.min(100, top))}
                  adv.FullName AS fullName, adv.Username AS username
             FROM dbo.protectioncase f
             LEFT JOIN dbo.useraccount adv ON adv.UserAccountKey = f.PrimaryAdviserUserAccountKey
            WHERE ${base.clause} AND f.CreatedDate = @D
            ORDER BY f.ProtectionPolicyAmount DESC;`,
    params,
  };
}

export interface SaleEvent {
  fullName: string | null;
  username: string | null;
  policyAmount: number | null;
}

export function saleEvents(day: string, top = 25): BuiltQuery {
  // protectioncase has no LeadDate — the migration guard (mortgagecase-only) doesn't apply here.
  const base = combine(orgFilter("f"), notDeleted("f"));
  const params: SqlParam[] = [...base.params, { name: "D", value: day, kind: "date" }];
  return {
    text: `SELECT TOP ${Math.max(1, Math.min(100, top))}
                  adv.FullName AS fullName, adv.Username AS username, f.ProtectionPolicyAmount AS policyAmount
             FROM dbo.protectioncase f
             LEFT JOIN dbo.useraccount adv ON adv.UserAccountKey = f.PrimaryAdviserUserAccountKey
            WHERE ${base.clause} AND f.WrittenDate = @D
            ORDER BY f.ProtectionPolicyAmount DESC;`,
    params,
  };
}
