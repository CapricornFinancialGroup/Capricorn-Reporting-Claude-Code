// Screen 2 — Office Run Chase: a card per office (4 KPI rows + mini %-to-pace chart), champion
// celebration on the leader, and the overall ranking strip.

import { usePayload } from "../api.js";
import { pctPaceChart, STATUS_COLOR } from "../charts.js";
import { EChart } from "../components/EChart.js";
import { StatusPill } from "../components/StatusPill.js";
import { num, shortDate, signed } from "../format.js";
import type { OfficeRunChasePayload } from "../types.js";
import { Load, type PageProps } from "./common.js";

const KPI_SHORT: Record<string, string> = {
  leads: "LEADS",
  applications: "APPS",
  referrals: "REFS",
  sales: "SALES",
};

export function OfficeRunChase({ filters, mode, refreshMs }: PageProps) {
  const { data, error } = usePayload<OfficeRunChasePayload>("office-run-chase", filters, mode, refreshMs);
  return (
    <Load error={error} data={data}>
      {data && (
        <div className="screen">
          <div className="card" style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: "8px 14px" }}>
            <span className="card-title" style={{ marginBottom: 0 }}>Overall Ranking — % to weekly target pace</span>
            <span className="asof">Week {shortDate(data.week.start)} – {shortDate(data.week.end)} · data as of {shortDate(data.dataAsOf)} · expected {data.week.expectedPct}%</span>
          </div>

          <div className="row cols-3 grow">
            {data.offices.map((o) => {
              const champion = o.office === data.champion;
              return (
                <div key={o.office} className={`card office-card ${champion ? "champion" : ""}`}>
                  {champion && <div className="leading-badge">Leading</div>}
                  <div className="office-head">
                    <span className="office-title">{o.office}</span>
                    {o.pct != null ? <StatusPill status={o.status} label={`${o.pct}% of pace`} /> : <span className="pill muted">No target</span>}
                  </div>
                  <div className="office-kpis">
                    {o.kpis.map((k) => {
                      const fillPct = k.target > 0 ? Math.min(100, Math.round((k.actual / k.target) * 100)) : 0;
                      return (
                        <div className="office-kpi" key={k.key}>
                          <span className="office-kpi-label">{KPI_SHORT[k.key]}</span>
                          <span className="office-kpi-val">{num(k.actual)}/{num(k.target)}</span>
                          <div className="progress-bar-bg">
                            <div
                              className="progress-bar-fill"
                              style={{ width: `${fillPct}%`, background: STATUS_COLOR[k.status] }}
                            />
                          </div>
                          <span className="office-kpi-gap" style={{ color: STATUS_COLOR[k.status] }}>
                            {k.status === "on_pace" ? "on pace" : `${signed(k.gap)} vs exp.`}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  <div className="grow" style={{ minHeight: 90 }}>
                    <EChart
                      height={110}
                      option={pctPaceChart({
                        days: o.chart.days,
                        actualPct: o.chart.actualPct,
                        targetPct: o.chart.targetPct,
                        color: STATUS_COLOR[o.status],
                      })}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="card">
            <div className="card-title"><span>Ranking Strip</span><span className="placeholder-note">Targets placeholder pending Capricorn confirmation</span></div>
            <div className="rank-strip">
              {data.offices.filter((o) => o.pct != null).map((o) => {
                const width = Math.min(100, Math.max(3, (o.pct ?? 0) / 1.5));
                return (
                  <div className="rank-bar-row" key={o.office}>
                    <span className="rank-bar-name">{o.rank != null ? `${o.rank}. ` : ""}{o.office}</span>
                    <div className="rank-bar-track">
                      <div className="rank-bar-fill" style={{ width: `${width}%`, background: STATUS_COLOR[o.status] }} />
                    </div>
                    <span className="rank-bar-pct">{o.pct}%</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </Load>
  );
}
