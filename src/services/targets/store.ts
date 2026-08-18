// Read-side of the weekly targets feature — an in-memory cache seeded from today's existing
// placeholder constants (domain/targets.ts), so behaviour is UNCHANGED until the first real upload
// lands. Preserves the "board is never blank" resilience this codebase already values everywhere.
//
// Uploaded figures are WEEKLY (the template's own unit); these getters expose DAILY targets, same
// shape as the domain/targets.ts constants they replace, since every existing call site already
// does `dailyTarget * 5` to get back to weekly — that idiom doesn't change, only its source does.

import { OFFICES } from "../../domain/offices.js";
import { DAILY_TARGETS, KPI_KEYS, OFFICE_DAILY_TARGETS, WRITTEN_WEEKLY_TARGET, type KpiTargets, type WrittenTargets } from "../../domain/targets.js";
import type { ParsedTargets } from "./parse.js";

/** The figures an upload can carry. Not `KpiKey`: `written` is the Revenue target (£, business-wide)
 *  rather than a per-office KPI, and `existingCases` is untargeted by design. */
export type CapturedTarget = "leads" | "applications" | "referrals" | "sales" | "written";
export const CAPTURED_TARGETS: CapturedTarget[] = ["leads", "applications", "referrals", "sales", "written"];
export type CapturedMap = Record<CapturedTarget, boolean>;

export function noneCaptured(): CapturedMap {
  return { leads: false, applications: false, referrals: false, sales: false, written: false };
}

export interface TargetsProvenance {
  source: "placeholder" | "upload";
  effectiveWeek: string | null;
  uploadedBy: string | null;
  uploadedAt: string | null;
  /** Set when the active targets are a blend of sources (e.g. the Datarails import only supplies
   *  Applications/Sales, leaving Leads/Referrals/Revenue whatever they were before) — surfaced on
   *  the Targets admin page so it's clear the figures aren't all from one upload. */
  note?: string;
  /** Which figures on the board are Capricorn's OWN, per figure — because "targets uploaded" and
   *  "every target is now yours" are different things, and the gap between them is what Kyle read as
   *  a failed upload ("I have uploaded targets for the week … but nothing has updated?",
   *  2026-08-18). His Datarails file carries Applications, Protection and Revenue but NOT Leads, so
   *  Leads stayed on our placeholder — correctly, invisibly, and indistinguishably from a no-op.
   *
   *  Sticky across uploads: a figure an earlier file supplied is still Capricorn's when a later file
   *  omits it, because the VALUE carries forward too (see getCurrentAsParsedTargets).
   *
   *  `null` = an upload that predates this field (nothing durable records which figures it set), so
   *  the page falls back to `note` rather than guessing. */
  captured: CapturedMap | null;
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
    provenance: { source: "placeholder", effectiveWeek: null, uploadedBy: null, uploadedAt: null, captured: noneCaptured() },
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

/** The group target = the sum of the offices the board actually SHOWS.
 *
 *  Restricted to the live roster because an upload outlives the roster it was written against: Kyle's
 *  15 Aug workbook still carries a Dubai row, and Dubai was retired on 2026-08-18. Summing it anyway
 *  would leave the group chasing a target no office on screen contributes to — the group total
 *  wouldn't equal the offices beneath it, which is the class of "the screens don't agree" complaint
 *  this whole thread is about. Same guard covers Türkiye and any future closure.
 *
 *  UNASSIGNED is excluded on the same principle and always has: it is not an office, and its targets
 *  are zero by design. */
function sumOffices(offices: Record<string, KpiTargets>): KpiTargets {
  const live = new Set(OFFICES.map((o) => o.name));
  const total: KpiTargets = { leads: 0, applications: 0, referrals: 0, sales: 0, existingCases: 0 };
  for (const [office, t] of Object.entries(offices)) {
    if (!live.has(office)) continue;
    for (const k of KPI_KEYS) total[k] += t[k] ?? 0;
  }
  return total;
}

/** What the captured map WOULD become if `captured` were activated now — the same OR-onto-previous
 *  the activation does, without mutating. Routes need this because the blob is written BEFORE the
 *  activation (so a failed write can't leave the UI claiming success), and the blob must store the
 *  merged map, not just this file's slice. Applying it twice is idempotent. */
export function mergeCaptured(captured?: Partial<CapturedMap> | null): CapturedMap | null {
  if (captured === null) return null;
  const previous = state.provenance.captured;
  return Object.fromEntries(
    CAPTURED_TARGETS.map((k) => [k, captured?.[k] === true || previous?.[k] === true]),
  ) as CapturedMap;
}

/** Activate a freshly-parsed, validated upload. Call ONLY after the blob write succeeds — never
 *  the other order, so a failed blob write can't leave the UI claiming success while nothing
 *  durable happened. `note` flags a blended-source activation (e.g. the Datarails import).
 *
 *  `captured` names the figures THIS file supplied; it is OR-ed onto what previous uploads supplied,
 *  because an omitted figure keeps its previous value and therefore its previous provenance. Pass
 *  `null` only when the caller genuinely cannot say (hydrating a blob written before the field
 *  existed) — that erases the map rather than asserting a half-truth about it. */
export function activateTargets(
  parsed: ParsedTargets,
  uploadedBy: string,
  uploadedAt: string,
  note?: string,
  captured?: Partial<CapturedMap> | null,
): void {
  const officeDaily: Record<string, KpiTargets> = {};
  for (const [office, weekly] of Object.entries(parsed.offices)) officeDaily[office] = divideBy5(weekly);
  const merged = mergeCaptured(captured);
  state = {
    officeDaily,
    daily: divideBy5(sumOffices(parsed.offices)),
    writtenWeekly: parsed.writtenWeekly,
    provenance: { source: "upload", effectiveWeek: parsed.effectiveWeek, uploadedBy, uploadedAt, note, captured: merged },
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
