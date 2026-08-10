// Week snapshots — the mechanism that lets the board answer "why has this number changed?"
//
// WHY THIS EXISTS. A closed Sat-Fri week is supposed to be final, and it is not. Sat 25-31 Jul 2026
// read 30 protection cases / £68,951 on 4 August, and 28 cases / £64,341.82 on 10 August, from an
// identical query against an unchanged codebase. That was reported to Capricorn's CFO as an exact
// match to his own Total Written Report, and six days later it silently was not. Nothing in the
// system noticed; it was found by hand, by accident.
//
// Two causes, and they need telling apart:
//
//   • INPUT LAG (expected). Business written in a week is entered days later, so a just-closed week
//     climbs for ~2 weeks (INPUT_LAG_SETTLE_DAYS). Already surfaced as `provisional`.
//   • BUSINESS LEAVING A CLOSED WEEK (not expected). Cases that were counted stop being counted —
//     deleted upstream, or dropped by the ETL. In the July case the surviving rows' `_etl_modified`
//     never moved, so the rows did not change: they left. `MAX(_etl_modified)`, which is what the
//     header's freshness stamp reads, CANNOT SEE THIS — a vanished row has no watermark. The only
//     way to detect it is to have written the earlier figure down.
//
// So: observe each closed week repeatedly, store every value it has ever reported, and classify the
// movement. A week that only ever climbs inside the settle window is settling. A week that climbs
// after it, or that falls at any point, is a revision someone has to explain.
//
// Pure logic only — blob I/O lives in blob.ts so this unit-tests without Azure.

import { INPUT_LAG_SETTLE_DAYS } from "../../domain/data-quality.js";
import { shiftDays } from "../reporting/trends.js";

/** The written figures a closed week is expected to hold still. */
export interface WeekFigures {
  mortgageCommission: number;
  mortgageCases: number;
  protectionCommission: number;
  protectionCases: number;
  clientFees: number;
}

export const FIGURE_KEYS = [
  "mortgageCommission",
  "mortgageCases",
  "protectionCommission",
  "protectionCases",
  "clientFees",
] as const;

export interface WeekObservation {
  /** When we looked (ISO). */
  observedAt: string;
  /** The lake load that produced it — ties a movement to a specific ETL run when there is one. */
  lakeLoadedAt: string | null;
  /** Capricorn group: both entities, what every other screen reports. */
  group: WeekFigures;
  /** Per entity, keyed by OrganisationKey as a string — Capricorn's own report runs inside one. */
  byOrg: Record<string, WeekFigures>;
}

export interface WeekSnapshot {
  /** Saturday. */
  weekStart: string;
  /** Friday. */
  weekEnd: string;
  /** Every DISTINCT value this week has reported, oldest first. Unchanged re-observations are not
   *  stored — the history is a list of changes, not a heartbeat. */
  observations: WeekObservation[];
}

/**
 * `reduced` — a figure went DOWN. Business that was counted no longer is. Always significant,
 *             whenever it happens.
 * `revised`  — went up after the settle window closed. Late entry beyond what input lag explains.
 * `settling` — went up inside the settle window. Normal; this is what `provisional` already warns of.
 * `none`     — the week has not moved since first observed.
 */
export type RevisionSeverity = "none" | "settling" | "revised" | "reduced";

export interface WeekRevision {
  weekStart: string;
  weekEnd: string;
  severity: RevisionSeverity;
  first: WeekObservation;
  latest: WeekObservation;
  /** latest − first, per figure. Negative means business left the week. */
  deltas: WeekFigures;
  /** How many times the figures have changed since first recorded. */
  changes: number;
  observedFrom: string;
  lastChangedAt: string | null;
  /** True when the most recent change landed after the settle window closed. */
  changedAfterSettle: boolean;
  /** The day after which movement is no longer explained by input lag. */
  settleThrough: string;
}

/** Money compares to the penny; counts are integers. Guards float noise from SUM(). */
const EPSILON = 0.005;

function differs(a: number, b: number): boolean {
  return Math.abs(a - b) > EPSILON;
}

export function figuresEqual(a: WeekFigures, b: WeekFigures): boolean {
  return FIGURE_KEYS.every((k) => !differs(a[k], b[k]));
}

function orgsEqual(a: Record<string, WeekFigures>, b: Record<string, WeekFigures>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const x = a[k];
    const y = b[k];
    if (!x || !y) return false;
    if (!figuresEqual(x, y)) return false;
  }
  return true;
}

export function observationsEqual(a: WeekObservation, b: WeekObservation): boolean {
  return figuresEqual(a.group, b.group) && orgsEqual(a.byOrg, b.byOrg);
}

/** The last day on which movement is still attributable to input lag. */
export function settleThrough(weekEnd: string): string {
  return shiftDays(weekEnd, INPUT_LAG_SETTLE_DAYS);
}

/**
 * Append an observation, but only when the figures actually moved.
 *
 * The FIRST observation is always kept whatever else is trimmed — it is the baseline every
 * comparison is made against, so dropping it would silently reset the week's history and hide
 * exactly the movement this exists to catch.
 */
export function appendObservation(
  snapshot: WeekSnapshot,
  observation: WeekObservation,
  maxHistory = 100,
): WeekSnapshot {
  const last = snapshot.observations[snapshot.observations.length - 1];
  if (last && observationsEqual(last, observation)) return snapshot;
  const observations = [...snapshot.observations, observation];
  if (observations.length > maxHistory) {
    // Keep the baseline, drop from the middle — the oldest changes are the least useful to keep
    // once there are a hundred of them, and the newest are what anyone is looking at.
    const trimmed = [observations[0], ...observations.slice(observations.length - (maxHistory - 1))];
    return { ...snapshot, observations: trimmed };
  }
  return { ...snapshot, observations };
}

export function emptySnapshot(weekStart: string): WeekSnapshot {
  return { weekStart, weekEnd: shiftDays(weekStart, 6), observations: [] };
}

function subtract(latest: WeekFigures, first: WeekFigures): WeekFigures {
  return Object.fromEntries(FIGURE_KEYS.map((k) => [k, latest[k] - first[k]])) as unknown as WeekFigures;
}

/** Classify how a week has moved since it was first recorded. Null when never observed.
 *
 *  `weekEnd` is DERIVED from `weekStart` rather than read back from the blob. It is stored for
 *  readability, but trusting a persisted copy of a value you can compute means one malformed blob
 *  throws out of here, out of loadRevisions, and 500s the screen — for a field that is always
 *  weekStart + 6. */
export function revisionOf(snapshot: WeekSnapshot): WeekRevision | null {
  const first = snapshot.observations[0];
  const latest = snapshot.observations[snapshot.observations.length - 1];
  if (!first || !latest) return null;

  const weekEnd = shiftDays(snapshot.weekStart, 6);
  const deltas = subtract(latest.group, first.group);
  const settle = settleThrough(weekEnd);
  const lastChangedAt = snapshot.observations.length > 1 ? latest.observedAt : null;
  const changedAfterSettle = lastChangedAt != null && lastChangedAt.slice(0, 10) > settle;

  const anyReduced = FIGURE_KEYS.some((k) => deltas[k] < -EPSILON);
  const anyChanged = FIGURE_KEYS.some((k) => differs(deltas[k], 0));

  const severity: RevisionSeverity = anyReduced
    ? "reduced"
    : !anyChanged
      ? "none"
      : changedAfterSettle
        ? "revised"
        : "settling";

  return {
    weekStart: snapshot.weekStart,
    weekEnd,
    severity,
    first,
    latest,
    deltas,
    changes: Math.max(0, snapshot.observations.length - 1),
    observedFrom: first.observedAt,
    lastChangedAt,
    changedAfterSettle,
    settleThrough: settle,
  };
}

/** Weeks worth flagging on the board — anything that moved in a way input lag doesn't explain. */
export function needsExplaining(revision: WeekRevision | null): boolean {
  return revision != null && (revision.severity === "reduced" || revision.severity === "revised");
}
