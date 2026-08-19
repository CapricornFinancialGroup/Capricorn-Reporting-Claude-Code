// Screen 2 — Office Run Chase: a card per office (4 KPI rows + mini %-to-pace chart), champion
// celebration on the leader, and the overall ranking strip.

import { usePayload } from "../api.js";
import { pctPaceChart, STATUS_COLOR } from "../charts.js";
import { EChart } from "../components/EChart.js";
import { MetricInfo } from "../components/MetricInfo.js";
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

export function OfficeRunChase({ meta, filters, mode, refreshMs }: PageProps) {
  const { data, error } = usePayload<OfficeRunChasePayload>("office-run-chase", filters, mode, refreshMs);
  return (
    <Load error={error} data={data}>
      {data && (
        <div className="screen">
          <div className="card" style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: "8px 14px" }}>
            <span className="card-title" style={{ marginBottom: 0 }}>% to Weekly Target Pace <span className="card-sub">fixed office order · ranked #1-{data.offices.length} by pace</span></span>
            <span className="asof">Week {shortDate(data.week.start)} – {shortDate(data.week.end)} · data as of {shortDate(data.dataAsOf)} · expected {data.week.expectedPct}%</span>
          </div>

          {/* One definitions strip rather than an ⓘ on all 4 KPIs × every office card — same reach,
              without 28 triggers competing with the numbers. */}
          <div className="funnel-defs" style={{ borderTop: "none", paddingTop: 0, marginTop: 0 }}>
            {[["leads", "Leads"], ["applications", "Mortgages Written"], ["referrals", "Protection Referrals"],
              ["sales", "Protection Sales"], ["pace", "% of Pace"]].map(([key, label]) => (
              <span className="funnel-def" key={key}>{label} <MetricInfo metricKey={key} mode={mode} /></span>
            ))}
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
                  <div className="chart-box" style={{ minHeight: 90 }}>
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
                  {/* Unassigned isn't a place — it's advisers we have no office on file for. Naming
                      them makes the row actionable: Capricorn read the list and tell us where each
                      one belongs. Kyle asked "what the 19 unassigned related to?" (2026-08-06). */}
                  {o.members && o.members.length > 0 && (
                    <div className="office-members" title="These advisers have no office recorded in the dashboard's mapping, so their business lands here instead of in their real office. Send us the office for each and they move.">
                      No office on file:{" "}
                      {o.members.slice(0, 6).map((m) => `${m.name} (${m.leads})`).join(", ")}
                      {o.members.length > 6 && ` +${o.members.length - 6} more`}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="card">
            {/* Follows provenance, like the header pill and the Daily Run Chase note. It was hardcoded
                and had been false since Kyle's first upload on 2026-08-13 — the twin of this line was
                fixed on 2026-08-18 and this copy was missed. */}
            <div className="card-title">
              <span>Ranking Strip</span>
              <span className="placeholder-note">
                {meta.targetsProvenance.source === "placeholder"
                  ? "Targets placeholder pending Capricorn confirmation"
                  : `Targets from Capricorn's upload${meta.targetsProvenance.effectiveWeek ? ` · week of ${shortDate(meta.targetsProvenance.effectiveWeek)}` : ""}`}
              </span>
            </div>
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
