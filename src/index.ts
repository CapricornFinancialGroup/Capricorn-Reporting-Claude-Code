// Production entrypoint. App Service runs `node dist/index.js` (see Bicep appCommandLine).
// No cron jobs: the lake is reloaded upstream (5× daily) and every dataset is computed on read
// (with a short server-side cache), so the app is a pure read-through HTTP server.

import { loadConfig } from "./config.js";
import { buildApp } from "./server/app.js";
import { logger } from "./services/logger.js";
import { hydrateFromStorage } from "./services/targets/blob.js";
import { activateTargets } from "./services/targets/store.js";

/** Best-effort load of the last-uploaded weekly targets. Storage unconfigured (local dev) or
 *  unreachable both fall back to the domain/targets.ts placeholders — never blocks startup, never
 *  crashes it (the "board is never blank" resilience this codebase values everywhere). */
async function hydrateTargets(storageAccount: string): Promise<void> {
  if (!storageAccount) return;
  try {
    const stored = await hydrateFromStorage(storageAccount);
    if (stored) {
      activateTargets(stored.parsed, stored.uploadedBy, stored.uploadedAt);
      logger.info("Hydrated weekly targets from storage", { effectiveWeek: stored.parsed.effectiveWeek, uploadedBy: stored.uploadedBy });
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

  const shutdown = async (signal: string): Promise<void> => {
    logger.info("Shutting down", { signal });
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
