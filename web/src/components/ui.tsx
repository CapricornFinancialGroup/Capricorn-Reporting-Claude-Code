// Small presentational building blocks shared across pages: KPI card, panel, simple table.

import type { ReactNode } from "react";
import { deltaClass } from "../format.js";

export function Panel({ title, subtitle, children, span = 6 }: {
  title?: string;
  subtitle?: string;
  children: ReactNode;
  /** Grid columns out of 12. */
  span?: number;
}) {
  return (
    <section className="panel" style={{ gridColumn: `span ${span}` }}>
      {title && <h2 className="panel-title">{title}</h2>}
      {subtitle && <p className="panel-sub">{subtitle}</p>}
      {children}
    </section>
  );
}

export function Kpi({ label, value, deltaText, deltaFraction, accent }: {
  label: string;
  value: ReactNode;
  deltaText?: string;
  deltaFraction?: number | null;
  accent?: string;
}) {
  return (
    <div className="kpi">
      <div className="kpi-value" style={accent ? { color: accent } : undefined}>{value}</div>
      <div className="kpi-label">{label}</div>
      {deltaText && <div className={`kpi-delta ${deltaClass(deltaFraction)}`}>{deltaText}</div>}
    </div>
  );
}

export function KpiRow({ children }: { children: ReactNode }) {
  return <div className="kpi-row">{children}</div>;
}

export interface Column<T> {
  header: string;
  cell: (row: T) => ReactNode;
  align?: "left" | "right";
}

export function Table<T>({ columns, rows, rowKey }: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
}) {
  return (
    <table className="data-table">
      <thead>
        <tr>
          {columns.map((c, i) => (
            <th key={i} style={{ textAlign: c.align ?? "left" }}>{c.header}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={rowKey(r)}>
            {columns.map((c, i) => (
              <td key={i} style={{ textAlign: c.align ?? "left" }}>{c.cell(r)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return <div className="error-note">⚠ {message}</div>;
}

/** A tiny inline-SVG trend line (no axes) for a table cell — cheap (one <svg>, no ECharts instance),
 *  so it scales to a row per rep. Scales to the series max; marks the latest point. */
export function Sparkline({ values, color = "#118DFF", width = 120, height = 28 }: {
  values: number[];
  color?: string;
  width?: number;
  height?: number;
}) {
  if (values.length === 0) return <span className="spark-empty">—</span>;
  const max = Math.max(1, ...values);
  const n = values.length;
  const stepX = n > 1 ? width / (n - 1) : 0;
  const yOf = (v: number) => height - (v / max) * (height - 3) - 1.5;
  const points = values.map((v, i) => `${(i * stepX).toFixed(1)},${yOf(v).toFixed(1)}`).join(" ");
  const lastX = (n - 1) * stepX;
  const lastY = yOf(values[n - 1]);
  return (
    <svg className="spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="trend">
      <polyline points={points} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lastX} cy={lastY} r={2.2} fill={color} />
    </svg>
  );
}
