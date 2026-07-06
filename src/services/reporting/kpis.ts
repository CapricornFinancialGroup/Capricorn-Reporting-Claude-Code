// The four core KPIs (Leads / Applications / Protection Referrals / Protection Sales) as pure
// query builders over the lake, in two grains:
//
//   • kpiDaily          — date → count (business-wide), drives MTD chase lines + weekly momentum
//   • kpiDailyByAdviser — date × adviser → count, drives office + adviser attribution (mapped to
//                         offices in TS via domain/offices.ts — office is config, not data)
//
// Semantics (verified against the live lake 2026-07-06; open questions flagged in the README):
//   leads         mortgagecase by LeadDate, COUNT(DISTINCT LeadId) (case rows are per product)
//   applications  mortgagecase by WrittenDate, COUNT(*) (per product written, dictionary ex. 4)
//   referrals     crosssellreferral by CreatedDate — the mortgagecase referral columns
//                 (ReferredToProtectionYN / ProtectionReferralDate) are UNPOPULATED for Capricorn
//                 (0 rows all-time), so the cross-sell fact is the source of truth. Adviser-declined
//                 and errored rows are excluded (a decline is not a referral).
//   sales         protectioncase by WrittenDate, COUNT(*)

import type { KpiKey } from "../../domain/targets.js";
import { combine, dateRange, notDeleted, orgFilter, whereClause, type Fragment } from "./filters.js";
import type { BuiltQuery } from "./query.js";

interface KpiSpec {
  table: string;
  dateColumn: string;
  countExpr: string;
  /** Extra AND-clause (no params), e.g. the referral decline/error exclusions. */
  extraClause: string;
  /** Adviser attribution key on the fact. */
  adviserKey: string;
  /** crosssellreferral has no DeletedYN column. */
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
    dateColumn: "WrittenDate",
    countExpr: "COUNT(*)",
    extraClause: "",
    adviserKey: "PrimaryAdviserUserAccountKey",
    hasDeletedFlag: true,
  },
  referrals: {
    table: "dbo.crosssellreferral",
    dateColumn: "CreatedDate",
    countExpr: "COUNT(*)",
    extraClause: "COALESCE(f.AdviserDeclinedYN, 'N') <> 'Y' AND COALESCE(f.HasErrorYN, 'N') <> 'Y'",
    adviserKey: "AdviserUserAccountKey",
    hasDeletedFlag: false,
  },
  sales: {
    table: "dbo.protectioncase",
    dateColumn: "WrittenDate",
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
