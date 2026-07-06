// Dashboard mode (/dashboard, Easy Auth) — the same five screens with nav tabs, fluid width.
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

export function App({ mode }: { mode: Mode }) {
  const { data: meta, error } = usePayload<Meta>("meta", EMPTY_FILTERS, mode, 0);
  const [pageId, setPageId] = useState(pageFromHash);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);

  useEffect(() => {
    const onHash = () => setPageId(pageFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  if (error) return <ErrorNote message={error} />;
  if (!meta) return <div className="loading">Loading…</div>;

  const page = PAGES.find((p) => p.id === pageId) ?? PAGES[0];
  const Page = page.Component;
  const filterable = FILTERABLE.has(page.id);
  // Run-chase screens always get EMPTY_FILTERS so they stay anchored on the current week.
  const pageFilters = filterable ? filters : EMPTY_FILTERS;
  return (
    <div className="dash-shell">
      <GosHeader title={page.label} />
      <nav className="dash-nav">
        {PAGES.map((p) => (
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
      {filterable && <FilterBar filters={filters} onChange={setFilters} />}
      <main className="dash-main">
        <Page meta={meta} filters={pageFilters} mode={mode} refreshMs={(meta.refreshSeconds ?? 60) * 1000} />
      </main>
    </div>
  );
}
