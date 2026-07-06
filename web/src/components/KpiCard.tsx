// Screen-1 KPI card: MTD actual vs monthly target with expected-now pacing, projection and a
// progress bar (strawman anatomy, month-to-date framing).

import type { Pace } from "../types.js";
import { num, signed } from "../format.js";
import { StatusPill } from "./StatusPill.js";

export function KpiCard({ name, pace, latestDay, latestLabel }: {
  name: string;
  pace: Pace;
  /** Count on the latest loaded day (the "yesterday" secondary stat). */
  latestDay: number;
  /** e.g. "Sun 5 Jul" */
  latestLabel: string;
}) {
  const pctOfTarget = pace.target > 0 ? Math.min(100, (pace.current / pace.target) * 100) : 0;
  const gapClass = pace.aheadBehind > 0 ? "val-green" : pace.aheadBehind < 0 ? "val-amber" : "val-blue";
  return (
    <div className={`card kpi-card ${pace.status}`}>
      <div className="kpi-name">{name}</div>
      <div className="kpi-main-row">
        <div className="kpi-current">{num(pace.current)}</div>
        <div className="kpi-target-block">
          <div className="kpi-target-label">Month target</div>
          <div className="kpi-target-val">{num(pace.target)}</div>
        </div>
      </div>
      <div className="kpi-stats-row">
        <div className="kpi-stat">
          <div className="kpi-stat-label">Expected now</div>
          <div className="kpi-stat-value">{num(pace.expectedByNow)}</div>
        </div>
        <div className="kpi-stat">
          <div className="kpi-stat-label">Gap vs exp.</div>
          <div className={`kpi-stat-value ${gapClass}`}>{signed(pace.aheadBehind)}</div>
        </div>
        <div className="kpi-stat">
          <div className="kpi-stat-label">Projected</div>
          <div className={`kpi-stat-value ${pace.projectedFinish >= pace.target ? "val-green" : "val-amber"}`}>
            {num(pace.projectedFinish)}
          </div>
        </div>
      </div>
      <div className="progress-wrap">
        <div className="progress-labels">
          <span>{latestLabel}: {num(latestDay)}</span>
          <span>{Math.round(pctOfTarget)}%</span>
        </div>
        <div className="progress-bar-bg">
          <div className="progress-bar-fill" style={{ width: `${pctOfTarget}%` }} />
        </div>
      </div>
      <div style={{ alignSelf: "flex-end", marginTop: 2 }}>
        <StatusPill status={pace.status} />
      </div>
    </div>
  );
}
