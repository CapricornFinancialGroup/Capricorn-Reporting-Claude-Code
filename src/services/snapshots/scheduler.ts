// Drives the week observer on a timer.
//
// Deliberately NOT triggered by dataset reads. The failure this catches — a closed week quietly
// losing business — happened over a weekend when nobody had the board open. If observation only
// happened on read, the first observation after a change would BE the change, and the movement
// would be invisible. The timer is what makes the baseline real.

import type { Config } from "../../config.js";
import { lastRefreshAt } from "../reporting/datasets.js";
import { tzToday } from "../reporting/pace.js";
import { logger } from "../logger.js";
import { recordClosedWeeks } from "./recorder.js";

export interface SnapshotScheduler {
  stop: () => void;
  /** Exposed for the health route and tests — runs one pass immediately. */
  runOnce: () => Promise<void>;
}

export function startSnapshotScheduler(config: Config): SnapshotScheduler {
  const runOnce = async (): Promise<void> => {
    try {
      const today = tzToday(new Date(), config.reporting.timeZone);
      const loadedAt = await lastRefreshAt(config);
      const outcome = await recordClosedWeeks(config, today, loadedAt, new Date().toISOString());
      if (outcome.skipped) {
        logger.info("Week snapshots disabled — no storage account configured");
      } else if (outcome.changed.length) {
        logger.warn("Closed week figures moved", { weeks: outcome.changed, observed: outcome.observed });
      } else {
        logger.info("Week snapshots steady", { observed: outcome.observed });
      }
    } catch (err) {
      // Never propagate: a snapshot failure must not take the board down.
      logger.error("Week snapshot pass failed", { err: String(err) });
    }
  };

  const intervalMs = Math.max(5, config.snapshots.intervalMinutes) * 60_000;
  // First pass shortly after boot rather than at t=0, so startup isn't competing with the first
  // dashboard requests for the Fabric connection.
  const kickoff = setTimeout(() => void runOnce(), 30_000);
  const timer = setInterval(() => void runOnce(), intervalMs);
  timer.unref?.();
  kickoff.unref?.();

  return {
    stop: () => {
      clearTimeout(kickoff);
      clearInterval(timer);
    },
    runOnce,
  };
}
