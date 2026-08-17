// Screen 1 — Weekly Run Chase (Conor's principles): a KPI card per measure with the cumulative Week
// Progress read, the weekly progress indicator strip (Mon 20.83% → Fri 100%), a weighted chase chart
// per TARGETED measure, office leaderboard, live-feed ticker.
//
// Cards and charts deliberately differ in count: since 2026-08-17 there are five cards (Leads split
// into new clients vs existing-client cases) but still four chase charts, because the fifth measure
// has no target to chase. See NEW_CLIENT_LEAD_BASIS on the server.

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
  // KPIs with a target, i.e. the ones a "week chase" chart can honestly be drawn for. Filtering on
  // `pace` rather than `targeted` also narrows the type, so the charts below need no non-null casts
  // beyond the ones TS still can't see through the closure.
  const chased = (data?.kpis ?? []).filter((k) => k.targeted && k.pace != null);
  // The leaderboard totals row reuses the leads KPI's own expected-by-now rather than recomputing it,
  // so the table and the card can never disagree about what "expected" means.
  const leadsKpi = data?.kpis.find((k) => k.key === "leads");
  return (
    <Load error={error} data={data}>
      {data && (
        <div className="screen">
          <Ticker mode={mode} refreshMs={refreshMs} />

          <div className={`row cols-${data.kpis.length}`}>
            {data.kpis.map((k) => (
              <KpiCard
                key={k.key}
                name={k.label}
                day={k.day}
                targeted={k.targeted}
                weeklyTarget={k.weeklyTarget}
                wtd={k.wtd}
                today={data.today ? { count: data.today.counts[k.key] ?? 0, loadedAt: data.today.loadedAt } : null}
                metricKey={k.key}
                mode={mode}
              />
            ))}
          </div>

          {/* The Total Lending bar sat here until 2026-08-17, removed on Capricorn's instruction.
              Lending is still on the board: Momentum's Avg Case Size covers loan value and its
              Weekly Written covers commission. */}

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
                      {data.week.dayNames[i]}
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
                ? <>Awaiting this week&rsquo;s data · last day {shortDate(data.week.latestDay)}</>
                : <>Expected so far: <b>{data.week.expectedPct}%</b></>}
            </span>
          </div>

          {/* Target pacing, so TARGETED KPIs only: a "week chase" chart for a measure with no target
              would be an actual line against an empty pace line, which reads as catastrophically
              behind rather than as untargeted. The tracked KPI still has its card above. */}
          <div className="row cols-4 grow">
            {chased.map((k) => (
              <div className="card" key={k.key}>
                <div className="card-title">
                  <span>{k.label} — week chase</span>
                  <StatusPill
                    status={k.pace!.status}
                    label={k.pace!.status === "on_pace" ? "On Pace" : `${k.pace!.status === "ahead" ? "Ahead" : "Behind"} ${signed(k.pace!.aheadBehind)}`}
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
                      behind: k.pace!.status === "behind",
                    })}
                  />
                </div>
              </div>
            ))}
          </div>

          {/* The table's window is stated in full, and it carries its own totals row. Capricorn read
              the cards' TODAY headline (28 new clients) against these week-to-date rows (40) and
              reported them as disagreeing — both figures were right, over different windows. Naming
              the window and totalling the column makes the tie to each card's "Week to date" stat
              visible instead of something you add up by eye. The window CANNOT simply be changed to
              include today: this table judges offices against target, and part-days must not be
              judged (see DATA_CADENCE.asOfRule). */}
          <div className="card">
            <div className="card-title">
              <span>
                Office Leaderboard{" "}
                <span className="card-sub">
                  — ranked by new-client leads · week to date, {shortDate(data.week.start)} – {shortDate(data.dataAsOf)} (complete days; today not included)
                </span>
              </span>
              <span className="asof">Expected {data.week.expectedPct}% of weekly target by now</span>
            </div>
            <table className="lb-table">
              <thead>
                <tr>
                  <th style={{ width: 44 }}>Rank</th>
                  <th>Office</th>
                  <th>New Clients</th>
                  <th>vs Target</th>
                  <th>Existing</th>
                  <th>Written</th>
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
                    {/* Actual vs expected-by-now on the ranked column, so "behind" carries a size.
                        Untargeted offices show a dash, never 0% — a zero reads as total failure. */}
                    <td style={{ fontVariantNumeric: "tabular-nums" }}>
                      {o.leadsPct == null ? (
                        <span style={{ color: "var(--text-secondary)" }}>—</span>
                      ) : (
                        <>
                          <b>{o.leadsPct}%</b>
                          <span style={{ color: "var(--text-secondary)", fontSize: 11 }}>
                            {" "}of {num(o.leadsExpected)}
                            {o.leadsGap != null && <> · <span className={o.leadsGap >= 0 ? "val-green" : "val-amber"}>{signed(o.leadsGap)}</span></>}
                          </span>
                        </>
                      )}
                    </td>
                    <td style={{ color: "var(--text-secondary)" }}>{num(o.existingCases)}</td>
                    <td>{num(o.applications)}</td>
                    <td>{num(o.referrals)}</td>
                    <td>{num(o.sales)}</td>
                    <td style={{ textAlign: "right" }}>
                      {o.hasTargets ? <StatusPill status={o.status} /> : <span className="pill muted">No target</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="lb-total">
                  <td />
                  <td className="office-name">All offices</td>
                  <td><b>{num(data.leaderboardTotals.leads)}</b></td>
                  <td style={{ color: "var(--text-secondary)", fontSize: 11 }}>
                    {leadsKpi?.pace ? <>of {num(leadsKpi.pace.expectedByNow)} expected</> : null}
                  </td>
                  <td><b>{num(data.leaderboardTotals.existingCases)}</b></td>
                  <td><b>{num(data.leaderboardTotals.applications)}</b></td>
                  <td><b>{num(data.leaderboardTotals.referrals)}</b></td>
                  <td><b>{num(data.leaderboardTotals.sales)}</b></td>
                  <td style={{ textAlign: "right", color: "var(--text-secondary)", fontSize: 11 }}>= card “week to date”</td>
                </tr>
              </tfoot>
            </table>
            <div className="placeholder-note" style={{ marginTop: 6 }}>
              Targets are placeholder values pending Capricorn confirmation; advisers without an office mapping show as Unassigned.
            </div>
          </div>
        </div>
      )}
    </Load>
  );
}
