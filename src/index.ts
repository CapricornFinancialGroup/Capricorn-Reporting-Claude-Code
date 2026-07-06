// Production entrypoint. App Service runs `node dist/index.js` (see Bicep appCommandLine).
// No cron jobs: the lake is rebuilt upstream (nightly) and every dataset is computed on read
// (with a short server-side cache), so the app is a pure read-through HTTP server.

import { loadConfig } from "./config.js";
import { buildApp } from "./server/app.js";
import { logger } from "./services/logger.js";

async function main(): Promise<void> {
  const config = loadConfig();
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
