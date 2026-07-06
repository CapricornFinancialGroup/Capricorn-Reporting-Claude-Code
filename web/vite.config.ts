import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

// The SPA builds to a SINGLE self-contained index.html (JS + CSS inlined) — no external asset
// files. This is required because App Service Easy Auth `excludedPaths` is EXACT-match only (no
// prefix/wildcard): we can exclude the exact path /screens but cannot exclude a /ui/assets/<hash>
// subtree for the anonymous kiosk. A single inlined file means the kiosk shell loads with zero
// extra requests. The dashboard (behind Easy Auth) serves the same file. Output → the server's
// dist/public so it ships in the existing deploy package. In dev, Vite serves the app + proxies /api.
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  build: {
    outDir: "../dist/public",
    emptyOutDir: true,
    // Inline ALL assets (service/lender logos) as data URIs — the single-file build serves no
    // separate asset files, so anything not inlined would 404. (viteSingleFile sets this too; we
    // pin it explicitly so the logo imports are guaranteed to inline.)
    assetsInlineLimit: 100_000_000,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
});
