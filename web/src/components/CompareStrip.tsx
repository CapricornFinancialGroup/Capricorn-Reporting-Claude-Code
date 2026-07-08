// "Compare to" side-by-side headline totals (item 8) — fires the page's existing single-window
// dataset fetch a second time against an independent {from,to} range and shows just the headline
// totals next to each other, not a second full copy of every chart (would clutter a screen
// that's already at capacity). No backend change: purely a second usePayload call + this strip.

import { gbpCompact, num } from "../format.js";

export interface CompareRow {
  label: string;
  primary: number | null;
  compare: number | null;
  fmt?: "int" | "gbp" | "pct";
}

function fmtVal(v: number | null, fmt: CompareRow["fmt"]): string {
  if (v == null) return "—";
  if (fmt === "gbp") return gbpCompact(v);
  if (fmt === "pct") return `${Math.round(v * 100)}%`;
  return num(Math.round(v));
}

export function CompareStrip({ primaryLabel, compareLabel, rows }: {
  primaryLabel: string;
  compareLabel: string;
  rows: CompareRow[];
}) {
  return (
    <div className="card compare-strip">
      <div className="card-title">
        <span>Compare</span>
        <span className="card-sub">{primaryLabel} vs {compareLabel}</span>
      </div>
      <div className="compare-grid">
        {rows.map((r) => {
          const delta = r.primary != null && r.compare != null && r.compare !== 0 ? (r.primary - r.compare) / r.compare : null;
          return (
            <div className="compare-cell" key={r.label}>
              <div className="compare-label">{r.label}</div>
              <div className="compare-values">
                <span className="compare-primary">{fmtVal(r.primary, r.fmt)}</span>
                <span className="compare-vs">vs</span>
                <span className="compare-secondary">{fmtVal(r.compare, r.fmt)}</span>
              </div>
              {delta != null && (
                <div className={delta >= 0 ? "val-green" : "val-red"} style={{ fontSize: 11, fontWeight: 700 }}>
                  {delta >= 0 ? "+" : ""}{Math.round(delta * 100)}%
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
