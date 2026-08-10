// Observes closed weeks against the lake and records any movement. The bridge between the
// reconciliation queries, the pure history logic and blob storage.
//
// Runs on a timer from the server (see index.ts) rather than on dataset reads: the whole point is to
// notice a week moving even when nobody is looking at the screen. Failures are logged and swallowed
// — a snapshot problem must never take the board down, because the board is what people are
// actually using.

import type { Config } from "../../config.js";
import { ORGANISATIONS } from "../../domain/firm.js";
import { logger } from "../logger.js";
import { mortgageWrittenByOrgDaily, protectionWrittenByOrgDaily, type ProtectionByOrgDaily, type WrittenByOrgDaily } from "../reporting/reconciliation.js";
import { run } from "../reporting/query.js";
import { shiftDays, weekStartOf } from "../reporting/trends.js";
import { describeError, readSnapshot, writeSnapshot } from "./blob.js";
import { appendObservation, revisionOf, type WeekFigures, type WeekObservation, type WeekRevision, type WeekSnapshot } from "./history.js";

/** How many closed weeks to keep under observation. A quarter is enough to see the settle curve and
 *  bounded enough that a run is a handful of small blob operations. */
export const OBSERVED_WEEKS = 13;

function zeroFigures(): WeekFigures {
  return {
    mortgageCommission: 0,
    mortgageCases: 0,
    protectionCommission: 0,
    protectionCases: 0,
    clientFees: 0,
  };
}

function isoDay(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

/** The `OBSERVED_WEEKS` most recent Sat-Fri weeks that have ENDED, oldest first.
 *  The current week is excluded on purpose: it is supposed to be moving. */
export function closedWeekStarts(today: string, count = OBSERVED_WEEKS): string[] {
  const currentWeek = weekStartOf(today);
  const weeks: string[] = [];
  for (let i = count; i >= 1; i--) weeks.push(shiftDays(currentWeek, -7 * i));
  return weeks;
}

/** Query the lake for each week's written figures, group and per entity. */
export async function observeWeeks(
  config: Config,
  weekStarts: string[],
  lakeLoadedAt: string | null,
  observedAt: string,
): Promise<Map<string, WeekObservation>> {
  const out = new Map<string, WeekObservation>();
  if (weekStarts.length === 0) return out;

  const from = weekStarts[0];
  const to = shiftDays(weekStarts[weekStarts.length - 1], 6);
  const pool = { server: config.fabric.endpoint, database: config.fabric.database };

  const [mortgage, protection] = await Promise.all([
    run<WrittenByOrgDaily>(pool, mortgageWrittenByOrgDaily(from, to)),
    run<ProtectionByOrgDaily>(pool, protectionWrittenByOrgDaily(from, to)),
  ]);

  for (const weekStart of weekStarts) {
    const byOrg: Record<string, WeekFigures> = {};
    // Seed every entity, including ones with no business this week: a key that appears and
    // disappears would read as a change on its own.
    for (const org of ORGANISATIONS) byOrg[String(org.key)] = zeroFigures();
    const group = zeroFigures();
    out.set(weekStart, { observedAt, lakeLoadedAt, group, byOrg });
  }

  const add = (d: unknown, orgKey: number, apply: (f: WeekFigures) => void) => {
    const week = weekStartOf(isoDay(d));
    const obs = out.get(week);
    if (!obs) return;
    apply(obs.group);
    const org = obs.byOrg[String(orgKey)];
    if (org) apply(org);
  };

  for (const r of mortgage) {
    add(r.d, r.orgKey, (f) => {
      f.mortgageCommission += r.commission ?? 0;
      f.clientFees += r.clientFees ?? 0;
      f.mortgageCases += r.cases;
    });
  }
  for (const r of protection) {
    add(r.d, r.orgKey, (f) => {
      f.protectionCommission += r.commission ?? 0;
      f.protectionCases += r.cases;
    });
  }

  // Round money to the penny so float noise from SUM() can't masquerade as a revision.
  for (const obs of out.values()) {
    for (const f of [obs.group, ...Object.values(obs.byOrg)]) {
      f.mortgageCommission = Math.round(f.mortgageCommission * 100) / 100;
      f.protectionCommission = Math.round(f.protectionCommission * 100) / 100;
      f.clientFees = Math.round(f.clientFees * 100) / 100;
    }
  }
  return out;
}

export interface RecordOutcome {
  observed: number;
  changed: string[];
  skipped: boolean;
}

/**
 * Observe the recent closed weeks and persist any movement.
 *
 * Idempotent: an unchanged week writes nothing at all (appendObservation dedupes by content), so
 * running this every 30 minutes costs one query set and a handful of conditional reads.
 */
export async function recordClosedWeeks(
  config: Config,
  today: string,
  lakeLoadedAt: string | null,
  now: string,
): Promise<RecordOutcome> {
  const account = config.snapshots.storageAccount;
  if (!account) return { observed: 0, changed: [], skipped: true };

  const weeks = closedWeekStarts(today);
  const observations = await observeWeeks(config, weeks, lakeLoadedAt, now);
  const changed: string[] = [];

  for (const weekStart of weeks) {
    const observation = observations.get(weekStart);
    if (!observation) continue;
    try {
      // One retry: the only way this conflicts is another instance appending the same observation,
      // which the content dedupe then turns into a no-op.
      for (let attempt = 0; attempt < 2; attempt++) {
        const { snapshot, etag } = await readSnapshot(account, weekStart);
        const next = appendObservation(snapshot, observation);
        if (next === snapshot) break; // unchanged — nothing to write
        if (await writeSnapshot(account, next, etag)) {
          changed.push(weekStart);
          break;
        }
      }
    } catch (err) {
      logger.error("Week snapshot failed", { weekStart, err: describeError(err) });
    }
  }
  return { observed: weeks.length, changed, skipped: false };
}

/** Read back the stored history for a set of weeks and classify each one's movement. */
export async function loadRevisions(config: Config, weekStarts: string[]): Promise<WeekRevision[]> {
  const account = config.snapshots.storageAccount;
  if (!account) return [];
  const snapshots = await Promise.all(
    weekStarts.map(async (w): Promise<WeekSnapshot | null> => {
      try {
        return (await readSnapshot(account, w)).snapshot;
      } catch (err) {
        logger.error("Week snapshot read failed", { weekStart: w, err: describeError(err) });
        return null;
      }
    }),
  );
  return snapshots
    .map((s) => (s ? revisionOf(s) : null))
    .filter((r): r is WeekRevision => r != null);
}
