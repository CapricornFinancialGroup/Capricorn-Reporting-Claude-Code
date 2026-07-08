// Kiosk mode (/screens, token-gated) — full-screen 1920×1080 canvas scaled to the TV, no chrome
// beyond the navy header. Data polls on its own interval; rotation dwell = meta.cycleSeconds.
//
// Per-TV control via the `pages` query param (comma-separated page ids, in order):
//   /screens?k=…                     → cycle all five screens (default)
//   /screens?k=…&pages=daily         → PIN one screen, static (no rotation/progress)
//   /screens?k=…&pages=daily,funnel  → cycle just those

import { useEffect, useRef, useState } from "react";
import { EMPTY_FILTERS, KIOSK_TOKEN, usePayload, type Mode } from "./api.js";
import type { Meta } from "./types.js";
import { ErrorNote } from "./components/ui.js";
import { GosHeader } from "./components/GosHeader.js";
import { KIOSK_PAGE_IDS, PAGES, type PageDef } from "./pages/index.js";

/** The pages this kiosk shows, from `?pages=` (falls back to the full set), in order. Admin-only
 *  pages (Targets, Glossary) are excluded even from an explicit `?pages=` override — the kiosk has
 *  no signed-in identity to check isTargetsAdmin against (it's Easy-Auth-excluded, token-gated
 *  only), so there's no way to authorize one honestly. Without this, `?pages=targets` would put
 *  the upload form on an unattended office wall TV, which is exactly the gotcha this flag exists
 *  to prevent. */
function selectedRotation(): PageDef[] {
  const raw = new URLSearchParams(window.location.search).get("pages");
  const ids = raw ? raw.split(",").map((s) => s.trim()).filter(Boolean) : KIOSK_PAGE_IDS;
  const rot = ids
    .map((id) => PAGES.find((p) => p.id === id))
    .filter((p): p is PageDef => p != null && !p.adminOnly);
  const fallback = PAGES.filter((p) => !p.adminOnly);
  return rot.length ? rot : fallback;
}

const ROTATION = selectedRotation();

/** Scale the fixed 1920×1080 canvas to the viewport (strawman technique). */
function useCanvasScale(): number {
  const [scale, setScale] = useState(() => Math.min(window.innerWidth / 1920, window.innerHeight / 1080));
  useEffect(() => {
    const onResize = () => setScale(Math.min(window.innerWidth / 1920, window.innerHeight / 1080));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return scale;
}

/** How long before a change counts as "imminent" — the countdown + bar turn amber and the next
 *  page's name appears, so it's obvious the screen is about to switch (parity with CS Growth OS). */
const IMMINENT_SECONDS = 5;

export function Kiosk({ mode }: { mode: Mode }) {
  const { data: meta, error } = usePayload<Meta>("meta", EMPTY_FILTERS, mode, 0);
  const [index, setIndex] = useState(0);
  const scale = useCanvasScale();
  const cycleMs = (meta?.cycleSeconds ?? 20) * 1000;
  const rotates = ROTATION.length > 1; // a single pinned screen never rotates

  // Real per-second countdown to the next rotation (not just the CSS animation), so we can show
  // "Next: <page> in Ns" and flip the bar to amber in the last few seconds.
  const cycleStartedAt = useRef(Date.now());
  const [secondsLeft, setSecondsLeft] = useState(Math.round(cycleMs / 1000));

  useEffect(() => {
    cycleStartedAt.current = Date.now();
    setSecondsLeft(Math.round(cycleMs / 1000));
  }, [index, cycleMs]);

  useEffect(() => {
    if (!rotates) return;
    const id = window.setInterval(() => {
      const left = Math.max(0, Math.ceil((cycleMs - (Date.now() - cycleStartedAt.current)) / 1000));
      setSecondsLeft(left);
    }, 250);
    return () => window.clearInterval(id);
  }, [cycleMs, rotates]);

  useEffect(() => {
    if (!meta || !rotates) return;
    const id = window.setInterval(() => setIndex((i) => (i + 1) % ROTATION.length), cycleMs);
    return () => window.clearInterval(id);
  }, [meta, cycleMs, rotates]);

  if (error) {
    // The token hint only applies to the unattended kiosk surface; /wall is Easy-Auth'd.
    const hint = mode === "kiosk" && !KIOSK_TOKEN ? " (append ?k=<token> to the URL)" : "";
    return <div className="kiosk-viewport"><ErrorNote message={`Data unavailable: ${error}${hint}`} /></div>;
  }
  if (!meta) return <div className="kiosk-viewport"><div className="loading">Loading…</div></div>;

  const page = ROTATION[Math.min(index, ROTATION.length - 1)];
  const Page = page.Component;
  const nextPage = ROTATION[(index + 1) % ROTATION.length];
  const imminent = rotates && secondsLeft <= IMMINENT_SECONDS;
  return (
    <div className="kiosk-viewport">
      <div className="kiosk-canvas" style={{ transform: `scale(${scale})` }}>
        <GosHeader
          title={page.label}
          right={rotates ? (
            <div className="kiosk-dots">
              {ROTATION.map((p, i) => <span key={p.id} className={`dot ${i === index ? "dot-on" : ""}`} />)}
            </div>
          ) : undefined}
        />
        {rotates && (
          <div className={`kiosk-progress-row ${imminent ? "imminent" : ""}`}>
            <div className="kiosk-progress">
              <span key={index} style={{ animationDuration: `${cycleMs}ms` }} />
            </div>
            <span className="kiosk-progress-label">
              Next: {nextPage.label} in {secondsLeft}s
            </span>
          </div>
        )}
        <main className="grow" style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
          <Page
            meta={meta}
            filters={EMPTY_FILTERS}
            mode={mode}
            refreshMs={(meta.refreshSeconds ?? 60) * 1000}
          />
        </main>
      </div>
    </div>
  );
}
