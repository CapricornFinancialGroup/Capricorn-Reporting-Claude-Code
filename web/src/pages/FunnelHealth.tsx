// Screen 4 — Funnel Health: tapering funnel chart, stage metrics, active alerts,
// applications-vs-referrals gap chart, pulsing action queues.

import { usePayload } from "../api.js";
import { applicationsReferralsGapChart, funnelStagesChart } from "../charts.js";
import { EChart } from "../components/EChart.js";
import { num, shortDate } from "../format.js";
import type { FunnelHealthPayload } from "../types.js";
import { Load, type PageProps } from "./common.js";

/** Share-of-leads % is meaningless on tiny denominators — show "–" instead. */
const MIN_DENOMINATOR = 10;

export function FunnelHealth({ filters, mode, refreshMs }: PageProps) {
  const { data, error } = usePayload<FunnelHealthPayload>("funnel-health", filters, mode, refreshMs);
  return (
    <Load error={error} data={data}>
      {data && (
        <div className="screen">
          <div className="card">
            <div className="card-title">
              <span>Sales Pipeline — where is revenue getting stuck? <span className="card-sub">gross stage volumes {shortDate(data.window.from)} – {shortDate(data.window.to)} · % = share of period leads, not case-by-case conversion</span></span>
              <span className="asof">Data as of {shortDate(data.dataAsOf)}</span>
            </div>
            <EChart
              height={280}
              option={funnelStagesChart(
                data.stages.map((s, i) => {
                  const leadsCount = data.stages[0]?.count ?? 0;
                  const pct = i === 0 ? 100 : (data.conversions[i - 1]?.pct ?? 0);
                  const pctText = leadsCount >= MIN_DENOMINATOR ? `${pct}%` : "–";
                  return { name: s.label, value: s.count, label: `${s.label}\n${num(s.count)} · ${pctText}` };
                }),
              )}
            />
          </div>

          <div className="row cols-3 grow">
            <div className="card">
              <div className="card-title"><span>Stage Metrics</span></div>
              <table className="lb-table">
                <thead>
                  <tr><th>Stage</th><th>Volume (MTD)</th><th style={{ textAlign: "right" }}>Avg age (open)</th></tr>
                </thead>
                <tbody>
                  {data.stageMetrics.map((m) => (
                    <tr key={m.stage}>
                      <td className="office-name">{m.stage}</td>
                      <td>{num(m.count)}</td>
                      <td style={{ textAlign: "right" }}>{m.avgAgeDays != null ? `${m.avgAgeDays}d` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="card-title" style={{ marginTop: 10 }}><span>Active Alerts</span></div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {data.alerts.length === 0 && <div className="loading">No active alerts.</div>}
                {data.alerts.map((a) => (
                  <div className={`alert ${a.severity}`} key={a.title}>
                    <div className="alert-title">{a.title}</div>
                    <div className="alert-detail">{a.detail}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="card">
              <div className="card-title">
                <span>Applications vs Referrals</span>
                <span className="card-sub">the gap is the unreferred opportunity · indicative</span>
              </div>
              <div className="grow">
                <EChart height={430} option={applicationsReferralsGapChart(data.applicationsReferralsGap)} />
              </div>
            </div>

            <div className="card">
              <div className="card-title"><span>Cases Awaiting Action</span></div>
              <div className="queue-grid grow">
                {data.queues.map((qi) => (
                  <div className={`queue-btn ${qi.count > 0 ? "hot" : ""}`} key={qi.key}>
                    <span className="queue-label" style={{ color: qi.key === "refer-now" || qi.key === "call-now" ? "var(--red)" : "var(--amber)" }}>
                      {qi.label}
                    </span>
                    <span className="queue-count">{num(qi.count)}</span>
                    <span className="queue-sub">{qi.sub}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </Load>
  );
}
