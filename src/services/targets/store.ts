// Read-side of the weekly targets feature — an in-memory cache seeded from today's existing
// placeholder constants (domain/targets.ts), so behaviour is UNCHANGED until the first real upload
// lands. Preserves the "board is never blank" resilience this codebase already values everywhere.
//
// Uploaded figures are WEEKLY (the template's own unit); these getters expose DAILY targets, same
// shape as the domain/targets.ts constants they replace, since every existing call site already
// does `dailyTarget * 5` to get back to weekly — that idiom doesn't change, only its source does.

import { DAILY_TARGETS, KPI_KEYS, OFFICE_DAILY_TARGETS, REVENUE_DAILY_TARGET, type KpiTargets } from "../../domain/targets.js";
import type { ParsedTargets } from "./parse.js";

export interface TargetsProvenance {
  source: "placeholder" | "upload";
  effectiveWeek: string | null;
  uploadedBy: string | null;
  uploadedAt: string | null;
}

interface TargetsState {
  officeDaily: Record<string, KpiTargets>;
  daily: KpiTargets;
  revenueDaily: number;
  provenance: TargetsProvenance;
  /** The full weekly upload, kept for the next upload's week-over-week swing check. */
  lastParsed: ParsedTargets | null;
}

function placeholderState(): TargetsState {
  return {
    officeDaily: OFFICE_DAILY_TARGETS,
    daily: DAILY_TARGETS,
    revenueDaily: REVENUE_DAILY_TARGET,
    provenance: { source: "placeholder", effectiveWeek: null, uploadedBy: null, uploadedAt: null },
    lastParsed: null,
  };
}

let state: TargetsState = placeholderState();

function divideBy5(t: KpiTargets): KpiTargets {
  return Object.fromEntries(KPI_KEYS.map((k) => [k, t[k] / 5])) as KpiTargets;
}

function sumOffices(offices: Record<string, KpiTargets>): KpiTargets {
  const total: KpiTargets = { leads: 0, applications: 0, referrals: 0, sales: 0 };
  for (const t of Object.values(offices)) {
    for (const k of KPI_KEYS) total[k] += t[k];
  }
  return total;
}

/** Activate a freshly-parsed, validated upload. Call ONLY after the blob write succeeds — never
 *  the other order, so a failed blob write can't leave the UI claiming success while nothing
 *  durable happened. */
export function activateTargets(parsed: ParsedTargets, uploadedBy: string, uploadedAt: string): void {
  const officeDaily: Record<string, KpiTargets> = {};
  for (const [office, weekly] of Object.entries(parsed.offices)) officeDaily[office] = divideBy5(weekly);
  state = {
    officeDaily,
    daily: divideBy5(sumOffices(parsed.offices)),
    revenueDaily: parsed.revenueWeekly / 5,
    provenance: { source: "upload", effectiveWeek: parsed.effectiveWeek, uploadedBy, uploadedAt },
    lastParsed: parsed,
  };
}

/** Reset to the placeholder constants — used by tests; production has no "un-upload" path. */
export function resetTargetsForTest(): void {
  state = placeholderState();
}

export function getDailyTargets(): KpiTargets {
  return state.daily;
}

export function getOfficeDailyTargets(): Record<string, KpiTargets> {
  return state.officeDaily;
}

export function getRevenueDailyTarget(): number {
  return state.revenueDaily;
}

export function getTargetsProvenance(): TargetsProvenance {
  return state.provenance;
}

/** The last successfully-activated upload, for the next upload's swing check. Null before the
 *  first real upload (there's nothing to compare against yet). */
export function getLastParsed(): ParsedTargets | null {
  return state.lastParsed;
}
