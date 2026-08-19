// Read-side of the weekly targets feature — an in-memory cache seeded from today's existing
// placeholder constants (domain/targets.ts), so behaviour is UNCHANGED until the first real upload
// lands. Preserves the "board is never blank" resilience this codebase already values everywhere.
//
// Uploaded figures are WEEKLY (the template's own unit); these getters expose DAILY targets, same
// shape as the domain/targets.ts constants they replace, since every existing call site already
// does `dailyTarget * 5` to get back to weekly — that idiom doesn't change, only its source does.

import { DAILY_TARGETS, KPI_KEYS, OFFICE_DAILY_TARGETS, TARGETED_KPI_KEYS, WRITTEN_WEEKLY_TARGET, type KpiKey, type KpiTargets, type WrittenTargets } from "../../domain/targets.js";
import type { ParsedTargets } from "./parse.js";

export interface TargetsProvenance {
  source: "placeholder" | "upload";
  effectiveWeek: string | null;
  uploadedBy: string | null;
  uploadedAt: string | null;
  /** Set when the active targets are a blend of sources (e.g. the Datarails import only supplies
   *  Applications/Sales, leaving Leads/Referrals/Revenue whatever they were before) — surfaced on
   *  the Targets admin page so it's clear the figures aren't all from one upload. */
  note?: string;
  /**
   * KPIs whose target is NOT from the upload — still one of our derived stand-ins, carried through
   * the merge. Structured rather than left to `note`'s prose because the board has to be able to say
   * which figures Capricorn actually set.
   *
   * Leads is the standing case, and it matters: NEITHER import route supplies it (the Datarails route
   * lists "Leads" as unchanged unconditionally), so the 633/wk on the wall has never been set by
   * Capricorn — it is OUR headcount estimate, and it was calibrated when "lead" still meant any
   * mortgage case rather than a new client (2026-08-17). A red arrow against it was being read as a
   * verdict from Capricorn's own target. See NEW_CLIENT_LEAD_BASIS.
   */
  unconfirmed?: KpiKey[];
}

interface TargetsState {
  officeDaily: Record<string, KpiTargets>;
  daily: KpiTargets;
  /** WEEKLY written targets, £ — Mortgage + Insurance (the dashboard's "Revenue"). Kept weekly, not
   *  daily: written business is charted per week (Market Momentum), not paced day-by-day. */
  writtenWeekly: WrittenTargets;
  provenance: TargetsProvenance;
  /** The full weekly upload, kept for the next upload's week-over-week swing check. */
  lastParsed: ParsedTargets | null;
}

function placeholderState(): TargetsState {
  return {
    officeDaily: OFFICE_DAILY_TARGETS,
    daily: DAILY_TARGETS,
    writtenWeekly: WRITTEN_WEEKLY_TARGET,
    // Nothing uploaded yet, so NO target is Capricorn's.
    provenance: { source: "placeholder", effectiveWeek: null, uploadedBy: null, uploadedAt: null, unconfirmed: [...TARGETED_KPI_KEYS] },
    lastParsed: null,
  };
}

let state: TargetsState = placeholderState();

// `?? 0` on both: an upload source that predates a KPI (or simply has no column for an untargeted
// one) otherwise yields `undefined / 5` = NaN, which propagates silently into the office targets and
// renders as a blank gap on the wall rather than an error anyone would notice.
function divideBy5(t: KpiTargets): KpiTargets {
  return Object.fromEntries(KPI_KEYS.map((k) => [k, (t[k] ?? 0) / 5])) as KpiTargets;
}

function multiplyBy5(t: KpiTargets): KpiTargets {
  return Object.fromEntries(KPI_KEYS.map((k) => [k, (t[k] ?? 0) * 5])) as KpiTargets;
}

function sumOffices(offices: Record<string, KpiTargets>): KpiTargets {
  const total: KpiTargets = { leads: 0, applications: 0, referrals: 0, sales: 0, existingCases: 0 };
  for (const t of Object.values(offices)) {
    for (const k of KPI_KEYS) total[k] += t[k] ?? 0;
  }
  return total;
}

/** Activate a freshly-parsed, validated upload. Call ONLY after the blob write succeeds — never
 *  the other order, so a failed blob write can't leave the UI claiming success while nothing
 *  durable happened. `note` flags a blended-source activation (e.g. the Datarails import). */
export function activateTargets(
  parsed: ParsedTargets,
  uploadedBy: string,
  uploadedAt: string,
  note?: string,
  unconfirmed?: KpiKey[],
): void {
  const officeDaily: Record<string, KpiTargets> = {};
  for (const [office, weekly] of Object.entries(parsed.offices)) officeDaily[office] = divideBy5(weekly);
  state = {
    officeDaily,
    daily: divideBy5(sumOffices(parsed.offices)),
    writtenWeekly: parsed.writtenWeekly,
    provenance: { source: "upload", effectiveWeek: parsed.effectiveWeek, uploadedBy, uploadedAt, note, unconfirmed },
    lastParsed: parsed,
  };
}

/** The currently-active targets, reconstructed as a full WEEKLY `ParsedTargets` (i.e. undoing the
 *  ÷5 that getters normally expose) — the merge base for imports that only supply some KPIs (e.g.
 *  Datarails only has Applications/Sales). Works from the placeholder constants when nothing has
 *  been uploaded yet, so there's always a valid base to merge into. */
export function getCurrentAsParsedTargets(today: string): ParsedTargets {
  if (state.lastParsed) return state.lastParsed;
  const offices: Record<string, KpiTargets> = {};
  for (const [office, daily] of Object.entries(state.officeDaily)) offices[office] = multiplyBy5(daily);
  return { effectiveWeek: today, offices, writtenWeekly: state.writtenWeekly };
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

/** WEEKLY written targets, £ — Mortgage + Insurance (the dashboard's "Revenue"). */
export function getWrittenWeeklyTargets(): WrittenTargets {
  return state.writtenWeekly;
}

export function getTargetsProvenance(): TargetsProvenance {
  return state.provenance;
}

/** The last successfully-activated upload, for the next upload's swing check. Null before the
 *  first real upload (there's nothing to compare against yet). */
export function getLastParsed(): ParsedTargets | null {
  return state.lastParsed;
}
