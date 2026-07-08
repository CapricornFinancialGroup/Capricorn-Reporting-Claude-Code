// Date-range filter for the analytical dashboard screens (Adviser League, Funnel Health, Market
// Momentum). Presets + explicit from/to. The run-chase screens are live current-week boards and
// ignore this (the bar isn't shown on them).

import type { Filters } from "../api.js";

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function preset(id: string): { from: string; to: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const startOfWeek = () => {
    const d = new Date(now);
    const dow = (d.getDay() + 1) % 7; // 0 = Saturday — Capricorn's own reporting-week anchor
    d.setDate(d.getDate() - dow);
    return d;
  };
  switch (id) {
    case "this-week": return { from: iso(startOfWeek()), to: iso(now) };
    case "this-month": return { from: iso(new Date(y, m, 1)), to: iso(now) };
    case "last-month": return { from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) };
    case "this-quarter": {
      const q = Math.floor(m / 3) * 3;
      return { from: iso(new Date(y, q, 1)), to: iso(now) };
    }
    case "ytd": return { from: iso(new Date(y, 0, 1)), to: iso(now) };
    default: return { from: iso(new Date(y, m, 1)), to: iso(now) };
  }
}

const PRESETS = [
  { id: "this-week", label: "This week" },
  { id: "this-month", label: "This month" },
  { id: "last-month", label: "Last month" },
  { id: "this-quarter", label: "This quarter" },
  { id: "ytd", label: "YTD" },
];

export function FilterBar({ filters, onChange, compare, onCompareChange }: {
  filters: Filters;
  onChange: (f: Filters) => void;
  /** Second, independent {from,to} window for the "Compare to" toggle — null = off. */
  compare: Filters | null;
  onCompareChange: (f: Filters | null) => void;
}) {
  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch });
  const setCompare = (patch: Partial<Filters>) => compare && onCompareChange({ ...compare, ...patch });
  const active = Boolean(filters.from || filters.to);
  return (
    <div className="filter-bar">
      <span className="filter-label">Period</span>
      {PRESETS.map((p) => {
        const r = preset(p.id);
        const on = filters.from === r.from && filters.to === r.to;
        return (
          <button key={p.id} className={`filter-chip ${on ? "on" : ""}`} onClick={() => set(r)}>
            {p.label}
          </button>
        );
      })}
      <span className="filter-dates">
        <input type="date" value={filters.from ?? ""} max={filters.to ?? undefined}
          onChange={(e) => set({ from: e.target.value || null })} aria-label="From date" />
        <span className="filter-dash">→</span>
        <input type="date" value={filters.to ?? ""} min={filters.from ?? undefined}
          onChange={(e) => set({ to: e.target.value || null })} aria-label="To date" />
      </span>
      {active && (
        <button className="filter-chip clear" onClick={() => set({ from: null, to: null })}>Clear</button>
      )}
      <button
        className={`filter-chip ${compare ? "on" : ""}`}
        style={{ marginLeft: 8 }}
        onClick={() => onCompareChange(compare ? null : { from: null, to: null, offices: [] })}
      >
        Compare to{compare ? " ✕" : ""}
      </button>
      {compare && (
        <span className="filter-dates">
          <input type="date" value={compare.from ?? ""} max={compare.to ?? undefined}
            onChange={(e) => setCompare({ from: e.target.value || null })} aria-label="Compare from date" />
          <span className="filter-dash">→</span>
          <input type="date" value={compare.to ?? ""} min={compare.from ?? undefined}
            onChange={(e) => setCompare({ to: e.target.value || null })} aria-label="Compare to date" />
        </span>
      )}
    </div>
  );
}
