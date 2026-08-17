// The four core KPIs (Leads / Applications / Protection Referrals / Protection Sales) as pure
// query builders over the lake, in two grains:
//
//   • kpiDaily          — date → count (business-wide), drives MTD chase lines + weekly momentum
//   • kpiDailyByAdviser — date × adviser → count, drives office + adviser attribution (mapped to
//                         offices in TS via domain/offices.ts — office is config, not data)
//
// Semantics (verified against the live lake 2026-07-06; open questions flagged in the README):
//   leads         mortgagecase by LeadDate, COUNT(DISTINCT PrimaryClientKey), restricted to clients
//                 whose FIRST case this is — a lead is a NEW CLIENT (Capricorn 2026-08-17). Was
//                 COUNT(DISTINCT LeadId) over every case until then, which counted remortgages and
//                 repeat clients as new lead flow. See NEW_CLIENT_LEAD_BASIS in domain/data-quality.ts
//   existingCases mortgagecase by LeadDate, COUNT(*) of cases opened against a PRE-EXISTING client —
//                 the complement of `leads`. Remos, repeat clients, second applications. No target
//   applications  mortgagecase by WorkflowStatusPreOfferProcessingDate (= "written" as Capricorn's
//                 own Total Written Report defines it), COUNT(*) per product written
//   referrals     protectioncase by CreatedDate = protection OPPORTUNITIES opened. Was
//                 crosssellreferral until 2026-07-30 — which is PaymentShield/currency cross-sell,
//                 not protection. Capricorn does not record protection referrals as an event at all
//                 (see PROTECTION_OPPORTUNITY_NOTE in domain/data-quality.ts).
//   sales         protectioncase by ApplicationDate (Capricorn's "Date Submitted"), cases at status
//                 60/65/70/105/120. Reconciles to their Total Written Report — see
//                 PROTECTION_WRITTEN_DATE in domain/data-quality.ts for the £48,969 -> £68,951 proof

import { MORTGAGE_WRITTEN_DATE, PROTECTION_WRITTEN_DATE, PROTECTION_WRITTEN_STATUSES } from "../../domain/data-quality.js";
import type { KpiKey } from "../../domain/targets.js";
import { combine, dateRange, excludeMigrations, notDeleted, orgFilter, whereClause, type Fragment } from "./filters.js";
import type { BuiltQuery } from "./query.js";

/**
 * The first date each client appears anywhere on the platform — the spine of the lead definition.
 *
 * A lead is a NEW CLIENT (see NEW_CLIENT_LEAD_BASIS in domain/data-quality.ts for Capricorn's ruling
 * and why the platform's own `tblClient.AddDate` cannot be used). "New" means this case is the
 * client's first, across all three case types; anything else is an existing-client case.
 *
 * Deliberately NOT org-filtered: client identity spans both Capricorn entities, so a client whose
 * first case sat in the Consultancy is not new when Mortgages opens their second. It also keeps this
 * CTE parameter-free, so it can be inlined into any query without colliding with @Org/@From names.
 *
 * The migration batch is deliberately NOT excluded here either. Those rows are real back-book clients
 * mis-dated to 1 Jul 2026; whatever their stamped date, it precedes any lead we are classifying now,
 * so they correctly mark those clients as pre-existing. (The batch is still excluded from the leads
 * COUNT itself, via excludeMigrations, exactly as before.)
 */
export const CLIENT_FIRST_CASE_CTE = `clientFirstCase AS (
             SELECT ck, MIN(d) AS firstDay FROM (
               SELECT PrimaryClientKey AS ck, LeadDate AS d
                 FROM dbo.mortgagecase
                WHERE COALESCE(DeletedYN, 'N') <> 'Y' AND PrimaryClientKey IS NOT NULL AND LeadDate IS NOT NULL
               UNION ALL
               SELECT pcc.ClientKey, CAST(p.CreatedDate AS date)
                 FROM dbo.protectioncase p
                 JOIN dbo.protectioncaseclient pcc
                   ON pcc.GlobalCaseID = p.GlobalCaseID AND pcc.PrimaryClientYN = 'Y'
                WHERE COALESCE(p.DeletedYN, 'N') <> 'Y' AND p.CreatedDate IS NOT NULL
               UNION ALL
               SELECT gcc.ClientKey, CAST(g.CreatedDate AS date)
                 FROM dbo.generalinsurancecase g
                 JOIN dbo.generalinsurancecaseclient gcc
                   ON gcc.GlobalCaseID = g.GlobalCaseID AND gcc.PrimaryClientYN = 'Y'
                WHERE COALESCE(g.DeletedYN, 'N') <> 'Y' AND g.CreatedDate IS NOT NULL
             ) x GROUP BY ck
           )`;

/** Client-identity join for the two client-classified KPIs. LEFT, not INNER: a case whose client has
 *  no resolvable first-case row must not silently vanish from the lead count. PrimaryClientKey is in
 *  fact never NULL in this feed (verified across all 270,001 live cases), so this is a guard against
 *  the feed changing, not a live condition. */
const FIRST_CASE_JOIN = "LEFT JOIN clientFirstCase fc ON fc.ck = f.PrimaryClientKey";

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
  /** Inlined CTE body (without the leading WITH), for KPIs that need one. */
  cte?: string;
  /** Extra JOIN clause, applied after the fact table. Requires `cte` in practice. */
  join?: string;
}

export const KPI_SPECS: Record<KpiKey, KpiSpec> = {
  // A lead is a NEW CLIENT, not a new case (Capricorn 2026-08-17 — see NEW_CLIENT_LEAD_BASIS).
  // Counted DISTINCT on the client, matching the platform report's own one-row-per-client dedup, so
  // a new client who opens two products on day one is one lead.
  leads: {
    table: "dbo.mortgagecase",
    dateColumn: "LeadDate",
    countExpr: "COUNT(DISTINCT f.PrimaryClientKey)",
    // `>=` not `=`: firstDay is the MIN across the client's cases, so for a genuinely new client it
    // equals this LeadDate. The `>` half can only arise if a client's earliest case is dated later
    // than a case that references them (clock skew / backdating upstream) — still a first appearance,
    // so it belongs here rather than being dropped by both legs.
    extraClause: "(fc.firstDay IS NULL OR fc.firstDay >= f.LeadDate)",
    adviserKey: "PrimaryAdviserUserAccountKey",
    hasDeletedFlag: true,
    cte: CLIENT_FIRST_CASE_CTE,
    join: FIRST_CASE_JOIN,
  },
  // The complement of `leads`: work opened against a client already on the books — remortgages above
  // all, plus repeat clients and second applications. COUNT(*) because this counts CASES CREATED, not
  // clients; one client bringing two remos is two pieces of work. Ships with no target.
  existingCases: {
    table: "dbo.mortgagecase",
    dateColumn: "LeadDate",
    countExpr: "COUNT(*)",
    extraClause: "fc.firstDay < f.LeadDate",
    adviserKey: "PrimaryAdviserUserAccountKey",
    hasDeletedFlag: true,
    cte: CLIENT_FIRST_CASE_CTE,
    join: FIRST_CASE_JOIN,
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
  // Protection written on Capricorn's own basis: ApplicationDate (their "Date Submitted"), counting
  // cases that have reached submission or beyond. Reconciles to Kyle's £69K for Sat 25-31 Jul.
  sales: {
    table: "dbo.protectioncase",
    dateColumn: PROTECTION_WRITTEN_DATE,
    countExpr: "COUNT(*)",
    extraClause: `f.WorkflowStatusId IN (${PROTECTION_WRITTEN_STATUSES.map((s) => `'${s}'`).join(", ")})`,
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

/** `WITH …` prefix for the specs that need one (empty string otherwise). */
function withClause(s: KpiSpec): string {
  return s.cte ? `WITH ${s.cte}\n           ` : "";
}

/** Business-wide daily counts for a KPI over [from, to]. */
export function kpiDaily(kpi: KpiKey, from: string, to: string): BuiltQuery {
  const s = KPI_SPECS[kpi];
  const where = baseWhere(s, from, to);
  return {
    text: `${withClause(s)}SELECT CAST(f.${s.dateColumn} AS date) AS d, ${s.countExpr} AS n
             FROM ${s.table} f
             ${s.join ?? ""}
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
    text: `${withClause(s)}SELECT CAST(f.${s.dateColumn} AS date) AS d, adv.Username AS username,
                  adv.FullName AS fullName, ${s.countExpr} AS n
             FROM ${s.table} f
             ${s.join ?? ""}
             LEFT JOIN dbo.useraccount adv ON adv.UserAccountKey = f.${s.adviserKey}
            ${whereClause(where)}
            GROUP BY CAST(f.${s.dateColumn} AS date), adv.Username, adv.FullName
            ORDER BY d;`,
    params: where.params,
  };
}
