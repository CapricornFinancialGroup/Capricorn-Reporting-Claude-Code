// Production entrypoint. App Service runs `node dist/index.js` (see Bicep appCommandLine).
// Datasets are computed on read (with a short server-side cache) — the app is a read-through HTTP
// server over the lake. The one background job is the week-snapshot observer, which has to run on a
// timer rather than on read: it exists to catch a closed week's figures moving while nobody is
// watching. See services/snapshots/history.ts for what that failure looked like.

import { loadConfig } from "./config.js";
import { buildApp } from "./server/app.js";
import { logger } from "./services/logger.js";
import { hydrateFromStorage } from "./services/targets/blob.js";
import { activateTargets } from "./services/targets/store.js";
import { startSnapshotScheduler } from "./services/snapshots/scheduler.js";

/** Best-effort load of the last-uploaded weekly targets. Storage unconfigured (local dev) or
 *  unreachable both fall back to the domain/targets.ts placeholders — never blocks startup, never
 *  crashes it (the "board is never blank" resilience this codebase values everywhere). */
async function hydrateTargets(storageAccount: string): Promise<void> {
  if (!storageAccount) return;
  try {
    const stored = await hydrateFromStorage(storageAccount);
    if (stored) {
      // Legacy default of ["leads"] for blobs written before provenance was persisted (2026-08-19).
      // It is the honest FLOOR, not a guess: neither import route has ever supplied a Leads target —
      // the Datarails route lists it as unchanged unconditionally — so any pre-existing upload left
      // the leads figure as our own headcount estimate. Without this, the first restart after a
      // deploy would have the board claim 633/wk is Capricorn's number.
      const unconfirmed = stored.unconfirmed ?? (["leads"] as const).slice();
      activateTargets(stored.parsed, stored.uploadedBy, stored.uploadedAt, stored.note, unconfirmed);
      logger.info("Hydrated weekly targets from storage", {
        effectiveWeek: stored.parsed.effectiveWeek,
        uploadedBy: stored.uploadedBy,
        unconfirmed,
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

  const snapshots = startSnapshotScheduler(config);

  const shutdown = async (signal: string): Promise<void> => {
    logger.info("Shutting down", { signal });
    snapshots.stop();
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
