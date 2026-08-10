// Written-business queries broken out BY ORGANISATION — the reconciliation screen's source.
//
// Everything else on the board reports the Capricorn GROUP (both regulated entities, see
// domain/firm.ts). Capricorn's own Total Written Report is run from inside one entity at a time, so
// a group figure and their report disagree by the other entity's business and neither side is
// wrong. For Sat 25-31 Jul 2026 that is £413,541 group vs £381,559 CFM-only against Kyle's
// £384,402 — a £32k gap that read as a defect for a fortnight and was scope all along.
//
// So these queries carry `OrganisationKey` through instead of summing it away, and the screen shows
// both. The point is that nobody has to email to find out which one they are looking at.

import { MORTGAGE_WRITTEN_DATE, PROTECTION_WRITTEN_DATE, PROTECTION_WRITTEN_STATUSES } from "../../domain/data-quality.js";
import { combine, dateRange, notDeleted, orgFilter, whereClause } from "./filters.js";
import type { BuiltQuery } from "./query.js";

export interface WrittenByOrgDaily {
  d: string;
  orgKey: number;
  commission: number | null;
  clientFees: number | null;
  cases: number;
}

/** Daily written MORTGAGE commission, client fees and case count, split by entity.
 *  Same basis as momentum.revenueDaily — deliberately: if these two ever disagree, the
 *  reconciliation screen is lying about the board rather than explaining it. */
export function mortgageWrittenByOrgDaily(from: string, to: string): BuiltQuery {
  const where = combine(orgFilter("f"), notDeleted("f"), dateRange(`f.${MORTGAGE_WRITTEN_DATE}`, from, to));
  return {
    text: `SELECT CAST(f.${MORTGAGE_WRITTEN_DATE} AS date) AS d,
                  f.OrganisationKey AS orgKey,
                  SUM(COALESCE(f.ProductCommission, 0)) AS commission,
                  SUM(COALESCE(f.ClientFeeAmount, 0)) AS clientFees,
                  COUNT(*) AS cases
             FROM dbo.mortgagecase f
            ${whereClause(where)}
            GROUP BY CAST(f.${MORTGAGE_WRITTEN_DATE} AS date), f.OrganisationKey
            ORDER BY d;`,
    params: where.params,
  };
}

export interface ProtectionByOrgDaily {
  d: string;
  orgKey: number;
  commission: number | null;
  cases: number;
}

/** Daily written PROTECTION commission and case count, split by entity. Same basis as
 *  momentum.protectionWrittenDaily. */
export function protectionWrittenByOrgDaily(from: string, to: string): BuiltQuery {
  const where = combine(
    orgFilter("f"),
    notDeleted("f"),
    dateRange(`f.${PROTECTION_WRITTEN_DATE}`, from, to),
    { clause: `f.WorkflowStatusId IN (${PROTECTION_WRITTEN_STATUSES.map((s) => `'${s}'`).join(", ")})`, params: [] },
  );
  return {
    text: `SELECT CAST(f.${PROTECTION_WRITTEN_DATE} AS date) AS d,
                  f.OrganisationKey AS orgKey,
                  SUM(COALESCE(f.ProductCommission, 0)) AS commission,
                  COUNT(*) AS cases
             FROM dbo.protectioncase f
            ${whereClause(where)}
            GROUP BY CAST(f.${PROTECTION_WRITTEN_DATE} AS date), f.OrganisationKey
            ORDER BY d;`,
    params: where.params,
  };
}
