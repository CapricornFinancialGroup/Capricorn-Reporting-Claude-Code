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

/**
 * Against-target read for a single figure: a coloured arrow and a percentage, sitting beside the
 * number it judges. Capricorn asked for exactly this rather than a "vs Target" column (2026-08-17) —
 * a column of its own read as though every measure in the table were being judged, when only written
 * has a target.
 *
 * `pct` is the SIGNED deviation from expected-by-now, so the arrow carries the sign and the label
 * shows magnitude only: ▲ 12% means 12% ahead of pace, not 12% of target. Renders nothing at all
 * when `pct` is null — an office with no target gets no verdict, not a 0%.
 */
function PaceArrow({ pct, expected, actual }: { pct: number | null; expected: number; actual: number }) {
  if (pct == null) return null;
  const ahead = pct >= 0;
  const verdict = pct === 0 ? "exactly on pace" : `${Math.abs(pct)}% ${ahead ? "ahead of" : "behind"} pace`;
  return (
    <span
      className={`lb-pace ${ahead ? "lb-pace-up" : "lb-pace-down"}`}
      title={`${num(actual)} written vs ${num(expected)} expected by now — ${verdict}`}
    >
      {ahead ? "▲" : "▼"} {Math.abs(pct)}%
    </span>
  );
}

export function DailyRunChase({ filters, mode, refreshMs }: PageProps) {
  const { data, error } = usePayload<DailyRunChasePayload>("daily-run-chase", filters, mode, refreshMs);
  // KPIs with a target, i.e. the ones a "week chase" chart can honestly be drawn for. Filtering on
  // `pace` rather than `targeted` also narrows the type, so the charts below need no non-null casts
  // beyond the ones TS still can't see through the closure.
  const chased = (data?.kpis ?? []).filter((k) => k.targeted && k.pace != null);
  // The leaderboard's against-target read hangs off WRITTEN — the only measure Capricorn sets office
  // targets on — and reuses that KPI's own expected-by-now rather than recomputing it, so the table
  // and the card can never disagree about what "expected" means.
  const writtenKpi = data?.kpis.find((k) => k.key === "applications");
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
                    <td style={{ color: "var(--text-secondary)" }}>{num(o.existingCases)}</td>
                    {/* Written carries the against-target read inline rather than in its own column,
                        because written is the ONLY measure Capricorn sets office targets on — a
                        separate column implied the whole table was judged. */}
                    <td style={{ fontVariantNumeric: "tabular-nums" }}>
                      {num(o.applications)}
                      <PaceArrow pct={o.writtenPct} expected={o.writtenExpected} actual={o.applications} />
                    </td>
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
                  <td><b>{num(data.leaderboardTotals.existingCases)}</b></td>
                  {/* The all-offices arrow reuses the written KPI's own expectedByNow rather than
                      summing the per-office expectations, so the footer and the Mortgages Written
                      card can never disagree about what "expected" means. */}
                  <td style={{ fontVariantNumeric: "tabular-nums" }}>
                    <b>{num(data.leaderboardTotals.applications)}</b>
                    {writtenKpi?.pace && (
                      <PaceArrow
                        pct={
                          // Same "at least one case due" bar the per-office rows use, for the same
                          // reason — see writtenJudgeable on the server.
                          writtenKpi.pace.expectedByNow >= 1
                            ? Math.round((data.leaderboardTotals.applications / writtenKpi.pace.expectedByNow - 1) * 100)
                            : null
                        }
                        expected={writtenKpi.pace.expectedByNow}
                        actual={data.leaderboardTotals.applications}
                      />
                    )}
                  </td>
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
