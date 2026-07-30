// The shared report filter model + SQL fragment builders.
//
// One filter shape drives every dashboard dataset: a date range plus an optional office set.
// Office filtering is applied in TS after adviser→office mapping (see domain/offices.ts) because
// office is config, not data; dates filter in SQL against each fact's own date column.

import { ORGANISATION_KEYS } from "../../domain/firm.js";
import { MIGRATION_EXCLUSIONS } from "../../domain/data-quality.js";
import type { SqlParam } from "./query.js";

export interface ReportFilters {
  /** Inclusive lower bound, YYYY-MM-DD (or null = open). */
  from: string | null;
  /** Inclusive upper bound, YYYY-MM-DD (or null = open). */
  to: string | null;
  /** Office names; empty = all. Applied in TS after adviser→office mapping. */
  offices: string[];
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function isoOrNull(v: unknown): string | null {
  return typeof v === "string" && ISO.test(v) ? v : null;
}

/** Accept either a comma-joined string or a repeated query param; trim + drop blanks. */
function list(v: unknown): string[] {
  if (Array.isArray(v)) return v.flatMap(list);
  if (typeof v === "string") return v.split(",").map((s) => s.trim()).filter(Boolean);
  return [];
}

/** Parse a Fastify querystring object into the filter model (defensive — never throws). */
export function parseFilters(q: Record<string, unknown> | undefined): ReportFilters {
  const query = q ?? {};
  return {
    from: isoOrNull(query.from),
    to: isoOrNull(query.to),
    offices: list(query.office ?? query.offices),
  };
}

export const EMPTY_FILTERS: ReportFilters = { from: null, to: null, offices: [] };

/** A reusable AND-joined predicate fragment plus its params (empty `clause` = no constraint). */
export interface Fragment {
  clause: string;
  params: SqlParam[];
}

/** Firm scoping — every query carries this even though the share only holds Capricorn rows. */
export function orgFilter(alias = ""): Fragment {
  const col = alias ? `${alias}.OrganisationKey` : "OrganisationKey";
  const names = ORGANISATION_KEYS.map((_, i) => `@Org${i}`);
  return {
    clause: `${col} IN (${names.join(", ")})`,
    params: ORGANISATION_KEYS.map((value, i) => ({ name: `Org${i}`, value, kind: "int" })),
  };
}

/** Deleted-case exclusion (data-dictionary convention). */
export function notDeleted(alias = ""): Fragment {
  const col = alias ? `${alias}.DeletedYN` : "DeletedYN";
  return { clause: `COALESCE(${col}, 'N') <> 'Y'`, params: [] };
}

/** Exclude known bulk-migration batches from LEAD metrics (see domain/data-quality.ts).
 *  Alias must be a mortgagecase row (has OrganisationKey + LeadDate). Empty when nothing to exclude.
 *
 *  ⚠ LeadDate-keyed metrics ONLY. The batch is real business mis-dated on LeadDate, so it distorts
 *  "new leads on 1 Jul" and nothing else. Applying it to WrittenDate-keyed metrics (applications,
 *  written £, revenue) silently deletes genuine written business whose lead happens to sit in the
 *  batch — that cost 16 cases / £19,592 of July written commission before this was scoped down
 *  (Kyle's 2026-07-28 reconciliation). */
export function excludeMigrations(alias = "f"): Fragment {
  if (MIGRATION_EXCLUSIONS.length === 0) return { clause: "", params: [] };
  const clauses: string[] = [];
  const params: SqlParam[] = [];
  MIGRATION_EXCLUSIONS.forEach((m, i) => {
    clauses.push(`NOT (${alias}.OrganisationKey = @MigOrg${i} AND ${alias}.LeadDate = @MigDate${i})`);
    params.push({ name: `MigOrg${i}`, value: m.orgKey, kind: "int" });
    params.push({ name: `MigDate${i}`, value: m.leadDate, kind: "date" });
  });
  return { clause: clauses.join(" AND "), params };
}

/** Date-range predicate on a named column, e.g. dateRange("LeadDate", from, to). */
export function dateRange(column: string, from: string | null, to: string | null, prefix = ""): Fragment {
  const clauses: string[] = [];
  const params: SqlParam[] = [];
  if (from) {
    clauses.push(`${column} >= @${prefix}From`);
    params.push({ name: `${prefix}From`, value: from, kind: "date" });
  }
  if (to) {
    clauses.push(`${column} <= @${prefix}To`);
    params.push({ name: `${prefix}To`, value: to, kind: "date" });
  }
  return { clause: clauses.join(" AND "), params };
}

/** Combine fragments into a single WHERE body (no leading WHERE) + merged params. */
export function combine(...fragments: Fragment[]): Fragment {
  const active = fragments.filter((f) => f.clause);
  return {
    clause: active.map((f) => `(${f.clause})`).join(" AND "),
    params: active.flatMap((f) => f.params),
  };
}

/** Prefix a combined fragment with WHERE when non-empty (else ""). */
export function whereClause(fragment: Fragment): string {
  return fragment.clause ? `WHERE ${fragment.clause}` : "";
}
