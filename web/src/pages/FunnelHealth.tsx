// Screen 4 — Funnel Health: stage flow with conversion badges, stage metrics, active alerts,
// protection-opportunities donut, pulsing action queues.

import { usePayload } from "../api.js";
import { donutChart, GREEN, RED } from "../charts.js";
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
            <div className="funnel-flow">
              {data.stages.map((s, i) => (
                <FunnelCell
                  key={s.key}
                  stage={s}
                  conv={i < data.conversions.length ? data.conversions[i] : null}
                  leadsCount={data.stages[0]?.count ?? 0}
                  last={i === data.stages.length - 1}
                />
              ))}
            </div>
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
                <span>Protection Opportunities</span>
                <span className="card-sub">referrals vs applications written (period) · indicative</span>
              </div>
              <div className="grow" style={{ position: "relative", minHeight: 160, display: "flex", flexDirection: "column", justifyContent: "center" }}>
                <EChart
                  height={430}
                  option={donutChart([
                    { name: "Referred", value: data.donut.referred, color: GREEN },
                    { name: "Not yet referred", value: data.donut.notReferred, color: RED },
                  ])}
                />
                <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
                  <div style={{ fontSize: 26, fontWeight: 900 }}>{num(data.donut.notReferred)}</div>
                  <div className="card-sub" style={{ textTransform: "uppercase", letterSpacing: "0.1em" }}>Open</div>
                </div>
              </div>
              <div style={{ display: "flex", justifyContent: "space-around", fontSize: 11, fontWeight: 700 }}>
                <span className="val-green">Referred ({data.donut.referredPct ?? 0}%)</span>
                <span className="val-red">Not yet referred ({100 - (data.donut.referredPct ?? 0)}%)</span>
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

function FunnelCell({ stage, conv, leadsCount, last }: {
  stage: { key: string; label: string; count: number };
  conv: { pct: number } | null;
  leadsCount: number;
  last: boolean;
}) {
  return (
    <>
      <div className="funnel-stage">
        <div className="funnel-stage-count">{num(stage.count)}</div>
        <div className="funnel-stage-name">{stage.label}</div>
      </div>
      {!last && conv && (
        <div className="funnel-conv">
          <span className="funnel-conv-pct">{leadsCount >= MIN_DENOMINATOR ? `${conv.pct}%` : "–"}</span>
          <span className="funnel-conv-label">of leads</span>
        </div>
      )}
    </>
  );
}
