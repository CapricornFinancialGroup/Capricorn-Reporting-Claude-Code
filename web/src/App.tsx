// Dashboard mode (/dashboard, Easy Auth) — all five screens with nav tabs, fluid width. One MORE
// than the wall: Funnel Health is wallExcluded, so it appears here and not in the TV rotation.
// Deep-linkable via the URL hash (#advisers).

import { useEffect, useState } from "react";
import { EMPTY_FILTERS, usePayload, type Filters, type Mode } from "./api.js";
import type { Meta } from "./types.js";
import { ErrorNote } from "./components/ui.js";
import { GosHeader } from "./components/GosHeader.js";
import { FilterBar } from "./components/FilterBar.js";
import { PAGES } from "./pages/index.js";

// Screens that analyse a period → show the date filter. The run-chase screens are live
// current-week boards and always ignore the filter (they'd contradict "this week").
const FILTERABLE = new Set(["advisers", "funnel", "momentum"]);

function pageFromHash(): string {
  const id = window.location.hash.replace(/^#/, "");
  return PAGES.some((p) => p.id === id) ? id : PAGES[0].id;
}

/** See the note in Kiosk.tsx. `meta` carries the freshness stamp, the targets-placeholder flag and
 *  the changed-week alert; fetching it once per page load froze all three on any tab left open —
 *  which on the wall surface means permanently. A minute is plenty and the server caches it. */
const META_REFRESH_MS = 60_000;

export function App({ mode }: { mode: Mode }) {
  const { data: meta, error } = usePayload<Meta>("meta", EMPTY_FILTERS, mode, META_REFRESH_MS);
  const [pageId, setPageId] = useState(pageFromHash);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [compareFilters, setCompareFilters] = useState<Filters | null>(null);

  useEffect(() => {
    const onHash = () => setPageId(pageFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  if (error) return <ErrorNote message={error} />;
  if (!meta) return <div className="loading">Loading…</div>;

  // Admin-only pages (Targets, Glossary) are invisible to everyone else — same isTargetsAdmin gate
  // the upload route enforces server-side. A non-admin landing on one directly via URL hash (an
  // old bookmark, a shared link) falls back to the first visible page rather than rendering it.
  const visiblePages = PAGES.filter((p) => !p.adminOnly || meta.isTargetsAdmin);
  const page = visiblePages.find((p) => p.id === pageId) ?? visiblePages[0];
  const Page = page.Component;
  const filterable = FILTERABLE.has(page.id);
  // Run-chase screens always get EMPTY_FILTERS so they stay anchored on the current week.
  const pageFilters = filterable ? filters : EMPTY_FILTERS;
  // Only fetch the compare window once both dates are actually picked — a half-filled toggle
  // shouldn't fire a request with an open-ended range.
  const pageCompareFilters = filterable && compareFilters?.from && compareFilters?.to ? compareFilters : null;
  return (
    <div className="dash-shell">
      <GosHeader
        title={page.label}
        freshness={{ dataAsOf: meta.dataAsOf, dataThrough: meta.dataThrough, lastRefreshAt: meta.lastRefreshAt, loadsPerDay: meta.loadsPerDay, targetsProvenance: meta.targetsProvenance }}
        onTargetsClick={meta.isTargetsAdmin ? () => { window.location.hash = "targets"; setPageId("targets"); } : undefined}
      />
      <nav className="dash-nav">
        {visiblePages.map((p) => (
          <button
            key={p.id}
            className={`dash-tab ${p.id === page.id ? "on" : ""}`}
            onClick={() => {
              window.location.hash = p.id;
              setPageId(p.id);
            }}
          >
            {p.label}
          </button>
        ))}
        {/* Auto-rotating full-screen view for signed-in users (office wall / TV) — no token. */}
        <a className="dash-tab dash-tab-wall" href="/wall" title="Auto-rotating full-screen wall view">↻ Wall view</a>
      </nav>
      {filterable && (
        <FilterBar filters={filters} onChange={setFilters} compare={compareFilters} onCompareChange={setCompareFilters} />
      )}
      <main className="dash-main">
        <Page
          meta={meta}
          filters={pageFilters}
          compareFilters={pageCompareFilters}
          mode={mode}
          refreshMs={(meta.refreshSeconds ?? 60) * 1000}
        />
      </main>
    </div>
  );
}
