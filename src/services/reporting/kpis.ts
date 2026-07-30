// The four core KPIs (Leads / Applications / Protection Referrals / Protection Sales) as pure
// query builders over the lake, in two grains:
//
//   • kpiDaily          — date → count (business-wide), drives MTD chase lines + weekly momentum
//   • kpiDailyByAdviser — date × adviser → count, drives office + adviser attribution (mapped to
//                         offices in TS via domain/offices.ts — office is config, not data)
//
// Semantics (verified against the live lake 2026-07-06; open questions flagged in the README):
//   leads         mortgagecase by LeadDate, COUNT(DISTINCT LeadId) (case rows are per product)
//   applications  mortgagecase by WorkflowStatusPreOfferProcessingDate (= "written" as Capricorn's
//                 own Total Written Report defines it), COUNT(*) per product written
//   referrals     protectioncase by CreatedDate = protection OPPORTUNITIES opened. Was
//                 crosssellreferral until 2026-07-30 — which is PaymentShield/currency cross-sell,
//                 not protection. Capricorn does not record protection referrals as an event at all
//                 (see PROTECTION_OPPORTUNITY_NOTE in domain/data-quality.ts).
//   sales         protectioncase by WrittenDate, COUNT(*) (status 65 is only 20% populated — see
//                 PROTECTION_WRITTEN_DATE in domain/data-quality.ts)

import { MORTGAGE_WRITTEN_DATE, PROTECTION_WRITTEN_DATE } from "../../domain/data-quality.js";
import type { KpiKey } from "../../domain/targets.js";
import { combine, dateRange, excludeMigrations, notDeleted, orgFilter, whereClause, type Fragment } from "./filters.js";
import type { BuiltQuery } from "./query.js";

interface KpiSpec {
  table: string;
  dateColumn: string;
  countExpr: string;
  /** Extra AND-clause (no params), e.g. the referral decline/error exclusions. */
  extraClause: string;
  /** Adviser attribution key on the fact. */
  adviserKey: string;
  /** Some facts have no DeletedYN column. */
  hasDeletedFlag: boolean;
}

export const KPI_SPECS: Record<KpiKey, KpiSpec> = {
  leads: {
    table: "dbo.mortgagecase",
    dateColumn: "LeadDate",
    countExpr: "COUNT(DISTINCT f.LeadId)",
    extraClause: "",
    adviserKey: "PrimaryAdviserUserAccountKey",
    hasDeletedFlag: true,
  },
  applications: {
    table: "dbo.mortgagecase",
    // MORTGAGE_WRITTEN_DATE, not WrittenDate — the same basis as Capricorn's Total Written Report,
    // so the count and the £ on the board agree with each other AND with their report. See
    // domain/data-quality.ts for the proof and the accepted 6.4% exclusion.
    dateColumn: MORTGAGE_WRITTEN_DATE,
    countExpr: "COUNT(*)",
    extraClause: "",
    adviserKey: "PrimaryAdviserUserAccountKey",
    hasDeletedFlag: true,
  },
  // Protection OPPORTUNITIES — protection cases opened. Replaced `crosssellreferral` on 2026-07-30
  // after the full definition review; see PROTECTION_OPPORTUNITY_NOTE in domain/data-quality.ts for
  // why the old source was wrong and why the platform's own referral field is unusable here.
  referrals: {
    table: "dbo.protectioncase",
    dateColumn: "CreatedDate",
    countExpr: "COUNT(*)",
    extraClause: "",
    adviserKey: "PrimaryAdviserUserAccountKey",
    hasDeletedFlag: true,
  },
  sales: {
    table: "dbo.protectioncase",
    dateColumn: PROTECTION_WRITTEN_DATE,
    countExpr: "COUNT(*)",
    extraClause: "",
    adviserKey: "PrimaryAdviserUserAccountKey",
    hasDeletedFlag: true,
  },
};

function baseWhere(s: KpiSpec, from: string, to: string): Fragment {
  return combine(
    orgFilter("f"),
    s.hasDeletedFlag ? notDeleted("f") : { clause: "", params: [] },
    // The bulk-migration batch is mis-dated on LeadDate, so it only distorts LeadDate-keyed
    // metrics. Applying it to WrittenDate-keyed ones (applications) dropped genuine written
    // business — see excludeMigrations' own warning.
    s.dateColumn === "LeadDate" ? excludeMigrations("f") : { clause: "", params: [] },
    dateRange(`f.${s.dateColumn}`, from, to),
    { clause: s.extraClause, params: [] },
  );
}

export interface DailyCount {
  d: string; // YYYY-MM-DD (SQL Date → string via CAST)
  n: number;
}

/** Business-wide daily counts for a KPI over [from, to]. */
export function kpiDaily(kpi: KpiKey, from: string, to: string): BuiltQuery {
  const s = KPI_SPECS[kpi];
  const where = baseWhere(s, from, to);
  return {
    text: `SELECT CAST(f.${s.dateColumn} AS date) AS d, ${s.countExpr} AS n
             FROM ${s.table} f
            ${whereClause(where)}
            GROUP BY CAST(f.${s.dateColumn} AS date)
            ORDER BY d;`,
    params: where.params,
  };
}

export interface AdviserDailyCount {
  d: string;
  username: string | null;
  fullName: string | null;
  n: number;
}

/** Daily counts per adviser for a KPI over [from, to] (username drives office mapping in TS). */
export function kpiDailyByAdviser(kpi: KpiKey, from: string, to: string): BuiltQuery {
  const s = KPI_SPECS[kpi];
  const where = baseWhere(s, from, to);
  return {
    text: `SELECT CAST(f.${s.dateColumn} AS date) AS d, adv.Username AS username,
                  adv.FullName AS fullName, ${s.countExpr} AS n
             FROM ${s.table} f
             LEFT JOIN dbo.useraccount adv ON adv.UserAccountKey = f.${s.adviserKey}
            ${whereClause(where)}
            GROUP BY CAST(f.${s.dateColumn} AS date), adv.Username, adv.FullName
            ORDER BY d;`,
    params: where.params,
  };
}
