// Serves the reporting SPA shell. The SPA builds to a SINGLE self-contained index.html (JS + CSS
// inlined via vite-plugin-singlefile), so there are no external asset files to serve — this matters
// because Easy Auth `excludedPaths` is exact-match only and cannot exclude a hashed-asset subtree
// for the anonymous kiosk. One inlined file means /screens loads with zero extra requests.
//
//   GET /dashboard  → SPA shell (dashboard mode; Easy Auth enforced by the platform)
//   GET /screens    → SPA shell (kiosk mode; Easy-Auth-excluded, data is token-gated)
//
// Production serves dist/public/index.html; in local dev the SPA runs on the Vite dev server, so
// these routes 503 when dist/public is absent — expected.

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import type { FastifyInstance, FastifyReply } from "fastify";

// dist/server/static.js → ../public = dist/public
const INDEX = join(fileURLToPath(new URL("../public", import.meta.url)), "index.html");

export function registerSpaRoutes(app: FastifyInstance): void {
  const sendShell = (reply: FastifyReply): FastifyReply => {
    if (!existsSync(INDEX)) {
      return reply
        .code(503)
        .type("text/plain")
        .send("Reporting UI not built. Run `npm run build:web` (production) or use the Vite dev server.");
    }
    return reply.type("text/html; charset=utf-8").header("cache-control", "no-cache").send(readFileSync(INDEX));
  };

  // The client reads window.location.pathname to pick dashboard vs kiosk mode.
  app.get("/dashboard", async (_req, reply) => sendShell(reply));
  app.get("/screens", async (_req, reply) => sendShell(reply));
}
