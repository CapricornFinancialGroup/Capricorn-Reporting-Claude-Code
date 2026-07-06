// Kiosk mode (/screens, token-gated) — full-screen 1920×1080 canvas scaled to the TV, no chrome
// beyond the navy header. Data polls on its own interval; rotation dwell = meta.cycleSeconds.
//
// Per-TV control via the `pages` query param (comma-separated page ids, in order):
//   /screens?k=…                     → cycle all five screens (default)
//   /screens?k=…&pages=daily         → PIN one screen, static (no rotation/progress)
//   /screens?k=…&pages=daily,funnel  → cycle just those

import { useEffect, useState } from "react";
import { EMPTY_FILTERS, KIOSK_TOKEN, usePayload, type Mode } from "./api.js";
import type { Meta } from "./types.js";
import { ErrorNote } from "./components/ui.js";
import { GosHeader } from "./components/GosHeader.js";
import { KIOSK_PAGE_IDS, PAGES, type PageDef } from "./pages/index.js";

/** The pages this kiosk shows, from `?pages=` (falls back to the full set), in order. */
function selectedRotation(): PageDef[] {
  const raw = new URLSearchParams(window.location.search).get("pages");
  const ids = raw ? raw.split(",").map((s) => s.trim()).filter(Boolean) : KIOSK_PAGE_IDS;
  const rot = ids.map((id) => PAGES.find((p) => p.id === id)).filter((p): p is PageDef => Boolean(p));
  return rot.length ? rot : PAGES;
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

export function Kiosk({ mode }: { mode: Mode }) {
  const { data: meta, error } = usePayload<Meta>("meta", EMPTY_FILTERS, mode, 0);
  const [index, setIndex] = useState(0);
  const scale = useCanvasScale();
  const cycleMs = (meta?.cycleSeconds ?? 20) * 1000;
  const rotates = ROTATION.length > 1; // a single pinned screen never rotates

  useEffect(() => {
    if (!meta || !rotates) return;
    const id = window.setInterval(() => setIndex((i) => (i + 1) % ROTATION.length), cycleMs);
    return () => window.clearInterval(id);
  }, [meta, cycleMs, rotates]);

  if (error) {
    const hint = KIOSK_TOKEN ? "" : " (append ?k=<token> to the URL)";
    return <div className="kiosk-viewport"><ErrorNote message={`Kiosk data unavailable: ${error}${hint}`} /></div>;
  }
  if (!meta) return <div className="kiosk-viewport"><div className="loading">Loading…</div></div>;

  const page = ROTATION[Math.min(index, ROTATION.length - 1)];
  const Page = page.Component;
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
        {rotates && <div className="kiosk-progress"><span key={index} style={{ animationDuration: `${cycleMs}ms` }} /></div>}
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
