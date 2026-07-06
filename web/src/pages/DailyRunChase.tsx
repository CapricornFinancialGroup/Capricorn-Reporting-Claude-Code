// Screen 1 — Daily Run Chase (month-to-date framing): 4 KPI pace cards, 4 chase charts, office
// leaderboard, live-feed ticker. Layout mirrors the signed-off strawman.

import { usePayload } from "../api.js";
import { paceChart } from "../charts.js";
import { EChart } from "../components/EChart.js";
import { KpiCard } from "../components/KpiCard.js";
import { StatusPill } from "../components/StatusPill.js";
import { Ticker } from "../components/Ticker.js";
import { num, shortDate, signed } from "../format.js";
import type { DailyRunChasePayload } from "../types.js";
import { Load, type PageProps } from "./common.js";

export function DailyRunChase({ filters, mode, refreshMs }: PageProps) {
  const { data, error } = usePayload<DailyRunChasePayload>("daily-run-chase", filters, mode, refreshMs);
  return (
    <Load error={error} data={data}>
      {data && (
        <div className="screen">
          <div className="row cols-4">
            {data.kpis.map((k) => (
              <KpiCard
                key={k.key}
                name={k.label}
                pace={k.pace}
                latestDay={k.latestDay}
                latestLabel={shortDate(data.dataAsOf)}
              />
            ))}
          </div>

          <div className="row cols-4 grow">
            {data.kpis.map((k) => (
              <div className="card" key={k.key}>
                <div className="card-title">
                  <span>{k.label} — month chase</span>
                  <StatusPill
                    status={k.pace.status}
                    label={k.pace.status === "on_pace" ? "On Pace" : `${k.pace.status === "ahead" ? "Ahead" : "Behind"} ${signed(k.pace.aheadBehind)}`}
                  />
                </div>
                <div className="grow">
                  <EChart
                    height={430}
                    option={paceChart({
                      days: k.chart.days,
                      actual: k.chart.actual,
                      targetPace: k.chart.targetPace,
                      projection: k.chart.projection,
                      behind: k.pace.status === "behind",
                    })}
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="card">
            <div className="card-title">
              <span>Office Leaderboard <span className="card-sub">— ranked by leads · month to date</span></span>
              <span className="asof">Data as of {shortDate(data.dataAsOf)} · day {data.month.workingDaysElapsed} of {data.month.workingDaysTotal}</span>
            </div>
            <table className="lb-table">
              <thead>
                <tr>
                  <th style={{ width: 44 }}>Rank</th>
                  <th>Office</th>
                  <th>Leads</th>
                  <th>Applications</th>
                  <th>Referrals</th>
                  <th>Sales</th>
                  <th style={{ textAlign: "right" }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.leaderboard.map((o, i) => (
                  <tr key={o.office} className={i === 0 && o.hasTargets ? "rank-1" : undefined}>
                    <td className="rank-num"><span>{i + 1}</span></td>
                    <td className="office-name">{o.office}</td>
                    <td>{num(o.leads)}</td>
                    <td>{num(o.applications)}</td>
                    <td>{num(o.referrals)}</td>
                    <td>{num(o.sales)}</td>
                    <td style={{ textAlign: "right" }}>
                      {o.hasTargets ? <StatusPill status={o.status} /> : <span className="pill muted">No target</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="placeholder-note" style={{ marginTop: 6 }}>
              Targets are placeholder values pending Capricorn confirmation; advisers without an office mapping show as Unassigned.
            </div>
          </div>

          <Ticker mode={mode} refreshMs={refreshMs} />
        </div>
      )}
    </Load>
  );
}
