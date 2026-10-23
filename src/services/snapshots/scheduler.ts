// Drives the week observer on a timer.
//
// Deliberately NOT triggered by dataset reads. The failure this catches — a closed week quietly
// losing business — happened over a weekend when nobody had the board open. If observation only
// happened on read, the first observation after a change would BE the change, and the movement
// would be invisible. The timer is what makes the baseline real.
//
// PBI 93610: the timer still ticks on its own clock whoever is watching, but a tick only goes to Fabric
// when the Gold data version has moved since the last observation that completed. That is the whole of
// what the lake can have changed: it reloads four times a day, and re-reading it every 30 minutes in
// between was the measured 8.0-8.5 CU-h/day idle floor. When the version is not known (the probe has
// not succeeded yet, or has been failing) it observes every tick, as before: missing a real movement
// is worse than one redundant read.

import type { Config } from "../../config.js";
import { clearCache } from "../reporting/cache.js";
import { lastRefreshAt } from "../reporting/datasets.js";
import { tzToday } from "../reporting/pace.js";
import { logger } from "../logger.js";
import { recordClosedWeeks } from "./recorder.js";

export interface SnapshotScheduler {
  stop: () => void;
  /** Exposed for the health route and tests — runs one pass immediately. */
  runOnce: () => Promise<void>;
}

/** What the scheduler needs of the version watcher: the version, or null when it cannot be vouched for. */
export interface VersionSource {
  trustedVersion: () => string | null;
}

export function startSnapshotScheduler(config: Config, versionSource: VersionSource): SnapshotScheduler {
  // The version at the last observation that COMPLETED. A failed pass leaves it alone, so the next tick retries.
  let lastObservedVersion: string | null = null;

  const runOnce = async (): Promise<void> => {
    try {
      const version = versionSource.trustedVersion();
      if (version !== null && version === lastObservedVersion) {
        logger.info("Gold data version unchanged since the last week observation — skipping", { version });
        return;
      }
      const today = tzToday(new Date(), config.reporting.timeZone);
      const loadedAt = await lastRefreshAt(config);
      const outcome = await recordClosedWeeks(config, today, loadedAt, new Date().toISOString());
      if (outcome.skipped) {
        logger.info("Week snapshots disabled — no storage account configured");
      } else if (outcome.changed.length) {
        logger.warn("Closed week figures moved", { weeks: outcome.changed, observed: outcome.observed });
        // The revised-weeks warning and the reconciliation screen read the snapshot blob this just
        // wrote; the data version cannot see it, so drop the cached payloads built from the old one.
        clearCache();
      } else {
        logger.info("Week snapshots steady", { observed: outcome.observed });
      }
      lastObservedVersion = version;
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
