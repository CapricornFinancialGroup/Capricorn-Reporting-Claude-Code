// Screen-1 KPI card. Per Conor's 2026-07-06 feedback, the HEADLINE is day-referenced: the latest
// working day's actual vs that day's target, with a day ahead/behind. Week-to-date sits underneath
// as context (the cumulative trend chart lives on the card below this one).

import type { DayView } from "../types.js";
import { num, shortDate, signed, statusLabel } from "../format.js";
import { StatusPill } from "./StatusPill.js";

export function KpiCard({ name, day, weeklyTarget, wtd }: {
  name: string;
  day: DayView;
  weeklyTarget: number;
  wtd: number;
}) {
  const pctOfDay = day.target > 0 ? Math.min(100, (day.actual / day.target) * 100) : 0;
  const gapClass = day.gap > 0 ? "val-green" : day.gap < 0 ? "val-amber" : "val-blue";
  const wtdPct = weeklyTarget > 0 ? Math.round((wtd / weeklyTarget) * 100) : 0;
  return (
    <div className={`card kpi-card ${day.status}`}>
      <div className="kpi-name">{name} <span className="card-sub" style={{ letterSpacing: "0.04em" }}>· {shortDate(day.date)}</span></div>
      <div className="kpi-main-row">
        <div className="kpi-current">{num(day.actual)}</div>
        <div className="kpi-target-block">
          <div className="kpi-target-label">Day target</div>
          <div className="kpi-target-val">{num(day.target)}</div>
        </div>
      </div>
      <div className="kpi-stats-row">
        <div className="kpi-stat">
          <div className="kpi-stat-label">Vs day target</div>
          <div className={`kpi-stat-value ${gapClass}`}>{signed(day.gap)}</div>
        </div>
        <div className="kpi-stat">
          <div className="kpi-stat-label">Week to date</div>
          <div className="kpi-stat-value">{num(wtd)}</div>
        </div>
        <div className="kpi-stat">
          <div className="kpi-stat-label">Wk target</div>
          <div className="kpi-stat-value" style={{ color: "rgba(30,41,59,0.45)" }}>{num(weeklyTarget)}</div>
        </div>
      </div>
      <div className="progress-wrap">
        <div className="progress-labels">
          <span>Day {Math.round(pctOfDay)}%</span>
          <span>Week {wtdPct}%</span>
        </div>
        <div className="progress-bar-bg">
          <div className="progress-bar-fill" style={{ width: `${pctOfDay}%` }} />
        </div>
      </div>
      <div style={{ alignSelf: "flex-end", marginTop: 2 }}>
        <StatusPill status={day.status} label={`${statusLabel(day.status)}${day.status === "ahead" || day.status === "behind" ? ` ${signed(day.gap)}` : ""}`} />
      </div>
    </div>
  );
}
