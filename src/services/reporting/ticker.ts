// Live-feed ticker — real events from the latest complete day in the lake.
//
// PII rule: adviser names, lenders, introducer companies and £ values only — the ticker NEVER
// joins the client table (no client PII on an office wall).

import { combine, notDeleted, orgFilter } from "./filters.js";
import type { BuiltQuery, SqlParam } from "./query.js";

export interface ApplicationEvent {
  fullName: string | null;
  username: string | null;
  mortgageValue: number | null;
  lenderName: string | null;
}

export function applicationEvents(day: string, top = 25): BuiltQuery {
  const base = combine(orgFilter("f"), notDeleted("f"));
  const params: SqlParam[] = [...base.params, { name: "D", value: day, kind: "date" }];
  return {
    text: `SELECT TOP ${Math.max(1, Math.min(100, top))}
                  adv.FullName AS fullName, adv.Username AS username,
                  f.MortgageValue AS mortgageValue, l.LenderName AS lenderName
             FROM dbo.mortgagecase f
             LEFT JOIN dbo.useraccount adv ON adv.UserAccountKey = f.PrimaryAdviserUserAccountKey
             LEFT JOIN dbo.lender l ON l.LenderKey = f.LenderKey
            WHERE ${base.clause} AND f.WrittenDate = @D
            ORDER BY f.MortgageValue DESC;`,
    params,
  };
}

export interface LeadEvent {
  fullName: string | null;
  username: string | null;
  introducer: string | null;
}

export function leadEvents(day: string, top = 25): BuiltQuery {
  const base = combine(orgFilter("f"), notDeleted("f"));
  const params: SqlParam[] = [...base.params, { name: "D", value: day, kind: "date" }];
  return {
    text: `SELECT TOP ${Math.max(1, Math.min(100, top))}
                  adv.FullName AS fullName, adv.Username AS username,
                  CASE WHEN COALESCE(i.IntroducerIsMainBrokerageYN, 'N') = 'Y' THEN NULL
                       ELSE i.IntroducerCompany END AS introducer
             FROM dbo.mortgagecase f
             LEFT JOIN dbo.useraccount adv ON adv.UserAccountKey = f.PrimaryAdviserUserAccountKey
             LEFT JOIN dbo.introducer i ON i.IntroducerKey = f.IntroducerKey
            WHERE ${base.clause} AND f.LeadDate = @D
            ORDER BY f.LeadId DESC;`,
    params,
  };
}

export interface ReferralEvent {
  fullName: string | null;
  username: string | null;
}

export function referralEvents(day: string, top = 25): BuiltQuery {
  // Cross-sell referrals are the live referral signal (mortgagecase referral flags are unpopulated
  // for Capricorn). No DeletedYN on this fact.
  const base = orgFilter("f");
  const params: SqlParam[] = [...base.params, { name: "D", value: day, kind: "date" }];
  return {
    text: `SELECT TOP ${Math.max(1, Math.min(100, top))}
                  adv.FullName AS fullName, adv.Username AS username
             FROM dbo.crosssellreferral f
             LEFT JOIN dbo.useraccount adv ON adv.UserAccountKey = f.AdviserUserAccountKey
            WHERE ${base.clause} AND f.CreatedDate = @D
              AND COALESCE(f.AdviserDeclinedYN, 'N') <> 'Y' AND COALESCE(f.HasErrorYN, 'N') <> 'Y'
            ORDER BY f.CreatedAt DESC;`,
    params,
  };
}

export interface SaleEvent {
  fullName: string | null;
  username: string | null;
  policyAmount: number | null;
}

export function saleEvents(day: string, top = 25): BuiltQuery {
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
