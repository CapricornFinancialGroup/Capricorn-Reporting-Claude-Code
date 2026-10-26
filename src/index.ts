// Production entrypoint. App Service runs `node dist/index.js` (see Bicep appCommandLine).
// Datasets are computed on read through a server-side cache keyed on the Gold data version (see
// services/reporting/share-version.ts) — the app is a read-through HTTP server over the lake. Two
// background jobs run on timers rather than on read: the data-version probe, and the week-snapshot
// observer, which exists to catch a closed week's figures moving while nobody is watching (see
// services/snapshots/history.ts for what that failure looked like).

import { loadConfig } from "./config.js";
import { buildApp } from "./server/app.js";
import { logger } from "./services/logger.js";
import { setCacheScope } from "./services/reporting/cache.js";
import { startShareVersionWatcher } from "./services/reporting/share-version.js";
import { hydrateFromStorage } from "./services/targets/blob.js";
import { activateTargets, unconfirmedFrom } from "./services/targets/store.js";
import { startSnapshotScheduler } from "./services/snapshots/scheduler.js";

/** Best-effort load of the last-uploaded weekly targets. Storage unconfigured (local dev) or
 *  unreachable both fall back to the domain/targets.ts placeholders — never blocks startup, never
 *  crashes it (the "board is never blank" resilience this codebase values everywhere). */
async function hydrateTargets(storageAccount: string): Promise<void> {
  if (!storageAccount) return;
  try {
    const stored = await hydrateFromStorage(storageAccount);
    if (stored) {
      // `captured ?? null` — null means "this blob predates per-figure provenance", which is NOT the
      // same as "nothing was captured" and must not be flattened into it: the Targets page renders it
      // as unknown, and unconfirmedFrom() floors it at ["leads"] rather than guessing. That floor is
      // load-bearing — without it the first restart after a deploy would have the board claim the
      // 633/wk leads figure is Capricorn's, when no import route has ever supplied one.
      const captured = stored.captured ?? null;
      activateTargets(stored.parsed, stored.uploadedBy, stored.uploadedAt, stored.note, captured);
      logger.info("Hydrated weekly targets from storage", {
        effectiveWeek: stored.parsed.effectiveWeek,
        uploadedBy: stored.uploadedBy,
        unconfirmed: unconfirmedFrom(captured),
      });
    }
  } catch (err) {
    logger.warn("Failed to hydrate weekly targets from storage — using placeholders", { err: String(err) });
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  await hydrateTargets(config.targets.storageAccount);
  const app = await buildApp(config);

  // Bind 0.0.0.0 so App Service's front end can reach the container.
  await app.listen({ port: config.port, host: "0.0.0.0" });
  logger.info("Capricorn Growth OS listening", { port: config.port, env: config.nodeEnv });

  // The Gold data version (PBI 93610): one cheap probe on its own timer, and the scope the dataset cache
  // is keyed on. Off (REPORTING_KEY_ON_DATA_VERSION=false) = no probe, no scope, pure wall-clock TTLs.
  const shareVersion = config.reporting.keyOnDataVersion ? startShareVersionWatcher(config) : null;
  if (shareVersion) setCacheScope(() => shareVersion.cacheScope(), config.reporting.versionedCacheMaxSeconds * 1000);
  else logger.warn("Dataset cache is NOT keyed on the Gold data version (REPORTING_KEY_ON_DATA_VERSION=false)");

  const snapshots = startSnapshotScheduler(config, { trustedVersion: () => shareVersion?.trustedVersion() ?? null });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info("Shutting down", { signal });
    snapshots.stop();
    shareVersion?.stop();
    await app.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  logger.error("Fatal startup error", { err: String(err) });
  process.exit(1);
});
