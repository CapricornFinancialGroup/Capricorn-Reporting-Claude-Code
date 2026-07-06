// Screen-1 KPI card, weekly-chase framing (Conor's principles): count vs weekly target with the
// cumulative Week Progress block as the primary read — Actual % vs Expected % and ±pp of pace.

import type { Pace, WeekProgress } from "../types.js";
import { num, signed } from "../format.js";
import { StatusPill } from "./StatusPill.js";

export function KpiCard({ name, pace, weekProgress, latestDay, latestLabel }: {
  name: string;
  pace: Pace;
  weekProgress: WeekProgress;
  /** Count on the latest loaded day (the "yesterday" secondary stat). */
  latestDay: number;
  /** e.g. "Sun 5 Jul" */
  latestLabel: string;
}) {
  const actualPct = weekProgress.actualPct ?? 0;
  const expectedPct = weekProgress.expectedPct ?? 0;
  const gapPp = weekProgress.gapPp;
  const gapClass = gapPp == null ? "val-blue" : gapPp > 0 ? "val-green" : gapPp < 0 ? "val-amber" : "val-blue";
  return (
    <div className={`card kpi-card ${pace.status}`}>
      <div className="kpi-name">{name}</div>
      <div className="kpi-main-row">
        <div className="kpi-current">{num(pace.current)}</div>
        <div className="kpi-target-block">
          <div className="kpi-target-label">Week target</div>
          <div className="kpi-target-val">{num(pace.target)}</div>
        </div>
      </div>
      <div className="kpi-stats-row">
        <div className="kpi-stat">
          <div className="kpi-stat-label">Actual</div>
          <div className="kpi-stat-value">{actualPct}%</div>
        </div>
        <div className="kpi-stat">
          <div className="kpi-stat-label">Expected</div>
          <div className="kpi-stat-value">{expectedPct}%</div>
        </div>
        <div className="kpi-stat">
          <div className="kpi-stat-label">Vs pace</div>
          <div className={`kpi-stat-value ${gapClass}`}>
            {gapPp == null ? "—" : `${gapPp > 0 ? "+" : "−"}${Math.abs(gapPp)}pp`}
          </div>
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
          <span>{Math.round(Math.min(100, actualPct))}%</span>
        </div>
        <div className="progress-bar-bg">
          <div className="progress-bar-fill" style={{ width: `${Math.min(100, actualPct)}%` }} />
        </div>
      </div>
      <div style={{ alignSelf: "flex-end", marginTop: 2 }}>
        <StatusPill status={pace.status} />
      </div>
    </div>
  );
}
