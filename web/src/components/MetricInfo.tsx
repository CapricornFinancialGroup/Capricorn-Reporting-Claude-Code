// The ⓘ affordance on every tile, and the panel behind it.
//
// Conor, 2026-08-04: "I would like every KPI to be clickable so users can immediately understand
// exactly what they are looking at… nobody should ever need to send an email asking why one number
// differs from another."
//
// Content comes from ONE registry (src/domain/metrics.ts) served as the `definitions` dataset, so the
// tile, the Glossary and any written dictionary cannot drift apart. The panel deliberately leads with
// the plain-English definition and shows the status badge and caveat prominently: most of the
// July/August email traffic was about figures presented as settled when they weren't.

import { useEffect, useState } from "react";
import { EMPTY_FILTERS, usePayload, type Mode } from "../api.js";
import type { DefinitionsPayload, MetricDefinition, MetricStatus } from "../types.js";

const STATUS_LABEL: Record<MetricStatus, string> = {
  agreed: "Agreed definition",
  indicative: "Indicative",
  open: "Definition open",
};

export function StatusBadge({ status }: { status: MetricStatus }) {
  return <span className={`mi-status mi-status-${status}`}>{STATUS_LABEL[status]}</span>;
}

/** The panel body — also reused by the Glossary so the wording is identical in both places. */
export function MetricDetail({ m }: { m: MetricDefinition }) {
  return (
    <>
      <div className="mi-def">{m.definition}</div>
      {m.note && <div className={`mi-note mi-note-${m.status}`}>{m.note}</div>}
      <dl className="mi-fields">
        <dt>Calculation</dt><dd>{m.calculation}</dd>
        <dt>Source</dt><dd className="mi-mono">{m.source}</dd>
        <dt>Reconciles to</dt><dd>{m.reconcilesTo ?? "No equivalent Capricorn report"}</dd>
        <dt>Owner</dt><dd>{m.owner}</dd>
        <dt>Frequency</dt><dd>{m.frequency}</dd>
      </dl>
    </>
  );
}

/**
 * Clickable ⓘ next to a tile label. Renders nothing when the key has no definition yet — better an
 * absent affordance than one that opens an empty panel.
 *
 * `mode` is threaded through so the kiosk fetches via /api/kiosk (token) and the dashboard via
 * /api/reporting (Easy Auth), exactly like every other payload.
 */
export function MetricInfo({ metricKey, mode }: { metricKey: string; mode: Mode }) {
  const [open, setOpen] = useState(false);
  // Definitions are static config, so poll interval 0 — fetched once and cached by usePayload.
  const { data } = usePayload<DefinitionsPayload>("definitions", EMPTY_FILTERS, mode, 0);
  const m = data?.metrics.find((x) => x.key === metricKey);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!m) return null;
  return (
    <>
      <button
        type="button"
        className={`mi-trigger mi-trigger-${m.status}`}
        aria-label={`What does ${m.label} mean?`}
        title={`What does ${m.label} mean?`}
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
      >
        i
      </button>
      {open && (
        <div className="mi-backdrop" onClick={() => setOpen(false)} role="presentation">
          <div className="mi-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={`${m.label} definition`}>
            <div className="mi-head">
              <div>
                <div className="mi-title">{m.label}</div>
                <StatusBadge status={m.status} />
              </div>
              <button type="button" className="mi-close" aria-label="Close" onClick={() => setOpen(false)}>×</button>
            </div>
            <MetricDetail m={m} />
            {data && (
              <div className="mi-cadence">
                <strong>Data freshness.</strong> {data.cadence.summary}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
