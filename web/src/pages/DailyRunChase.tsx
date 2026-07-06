// Screen 1 — Weekly Run Chase (Conor's principles): 4 KPI cards with the cumulative Week Progress
// read, the weekly progress indicator strip (Mon 20.83% → Fri 100%), 4 weighted chase charts,
// office leaderboard, live-feed ticker.

import { usePayload } from "../api.js";
import { paceChart } from "../charts.js";
import { EChart } from "../components/EChart.js";
import { KpiCard } from "../components/KpiCard.js";
import { StatusPill } from "../components/StatusPill.js";
import { Ticker } from "../components/Ticker.js";
import { num, shortDate, signed } from "../format.js";
import type { DailyRunChasePayload } from "../types.js";
import { Load, type PageProps } from "./common.js";

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri"];

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
                day={k.day}
                weeklyTarget={k.weeklyTarget}
                wtd={k.wtd}
              />
            ))}
          </div>

          {/* Weekly progress indicator — where the team should be by end of each day. */}
          <div className="card" style={{ flexDirection: "row", alignItems: "center", gap: 14, padding: "8px 14px" }}>
            <span className="card-title" style={{ marginBottom: 0, whiteSpace: "nowrap" }}>
              This Week <span className="card-sub">{shortDate(data.week.start)} – {shortDate(data.week.end)}</span>
            </span>
            <div style={{ display: "flex", flex: 1, gap: 8 }}>
              {data.week.days.map((d, i) => {
                const done = d >= data.week.start && d <= data.dataAsOf;
                return (
                  <div key={d} style={{ flex: 1, textAlign: "center" }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: done ? "var(--navy)" : "var(--text-secondary)" }}>
                      {DAY_NAMES[i]}
                    </div>
                    <div className="progress-bar-bg" style={{ marginTop: 3 }}>
                      <div
                        className="progress-bar-fill"
                        style={{ width: done ? "100%" : "0%", background: done ? "var(--navy)" : undefined }}
                      />
                    </div>
                    <div style={{ fontSize: 9, color: "var(--text-secondary)", marginTop: 2, fontVariantNumeric: "tabular-nums" }}>
                      {data.week.cumulativeSharesPct[i]}%
                    </div>
                  </div>
                );
              })}
            </div>
            <span className="asof" style={{ whiteSpace: "nowrap" }}>
              {data.week.pending
                ? <>Awaiting this week&rsquo;s data · last day {shortDate(data.week.latestWorkingDay)}</>
                : <>Expected so far: <b>{data.week.expectedPct}%</b></>}
            </span>
          </div>

          <div className="row cols-4 grow">
            {data.kpis.map((k) => (
              <div className="card" key={k.key}>
                <div className="card-title">
                  <span>{k.label} — week chase</span>
                  <StatusPill
                    status={k.pace.status}
                    label={k.pace.status === "on_pace" ? "On Pace" : `${k.pace.status === "ahead" ? "Ahead" : "Behind"} ${signed(k.pace.aheadBehind)}`}
                  />
                </div>
                <div className="grow">
                  <EChart
                    height={288}
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
              <span>Office Leaderboard <span className="card-sub">— ranked by leads · week to date</span></span>
              <span className="asof">Data as of {shortDate(data.dataAsOf)} · expected {data.week.expectedPct}% of weekly target</span>
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
