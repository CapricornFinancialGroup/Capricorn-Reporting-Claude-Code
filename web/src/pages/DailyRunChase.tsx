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
import type { DailyRunChasePayload, Pace } from "../types.js";
import { Load, type PageProps } from "./common.js";

/**
 * Against-target read for a single figure: a coloured arrow and a percentage, sitting beside the
 * number it judges. Capricorn asked for exactly this rather than a "vs Target" column (2026-08-17) —
 * a column of its own read as though the whole table were being judged.
 *
 * `pct` is the SIGNED deviation from expected-by-now, so the arrow carries the sign and the label
 * shows magnitude only: ▲ 12% means 12% ahead of pace, not 12% of target. Renders nothing at all
 * when `pct` is null — a measure with no target gets no verdict, not a 0%.
 */
function PaceArrow({ pct, expected, actual, noun }: { pct: number | null; expected: number; actual: number; noun: string }) {
  if (pct == null) return null;
  const ahead = pct >= 0;
  const verdict = pct === 0 ? "exactly on pace" : `${Math.abs(pct)}% ${ahead ? "ahead of" : "behind"} pace`;
  return (
    <span
      className={`lb-pace ${ahead ? "lb-pace-up" : "lb-pace-down"}`}
      title={`${num(actual)} ${noun} vs ${num(expected)} expected by now — ${verdict}`}
    >
      {ahead ? "▲" : "▼"} {Math.abs(pct)}%
    </span>
  );
}

/** One totals-row cell: the column sum, plus the all-offices against-target read for that KPI. */
function TotalCell({ total, kpi, noun }: { total: number; kpi: { pace: Pace | null } | undefined; noun: string }) {
  const expected = kpi?.pace?.expectedByNow ?? null;
  return (
    <td style={{ fontVariantNumeric: "tabular-nums" }}>
      <b>{num(total)}</b>
      {expected != null && (
        <PaceArrow
          pct={expected >= 1 ? Math.round((total / expected - 1) * 100) : null}
          expected={expected}
          actual={total}
          noun={noun}
        />
      )}
    </td>
  );
}

export function DailyRunChase({ meta, filters, mode, refreshMs }: PageProps) {
  const { data, error } = usePayload<DailyRunChasePayload>("daily-run-chase", filters, mode, refreshMs);
  // KPIs with a target, i.e. the ones a "week chase" chart can honestly be drawn for. Filtering on
  // `pace` rather than `targeted` also narrows the type, so the charts below need no non-null casts
  // beyond the ones TS still can't see through the closure.
  const chased = (data?.kpis ?? []).filter((k) => k.targeted && k.pace != null);
  // The totals row reuses each KPI's OWN expected-by-now rather than summing the per-office
  // expectations, so the footer and that KPI's card can never disagree about what "expected" means.
  const kpiByKey = new Map((data?.kpis ?? []).map((k) => [k.key, k]));
  // Whether the targets on screen are Capricorn's own upload or our derived stand-ins. Kyle has been
  // uploading the real weekly workbook since 2026-08-13, so the old unconditional "these are
  // placeholder values" line under the table had become untrue (Capricorn 2026-08-18 asked whether it
  // still was). It follows provenance now, exactly like the header pill.
  const placeholderTargets = meta.targetsProvenance.source === "placeholder";
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

          {/* Weekly progress indicator — where the team SHOULD be by end of each day. The bars mark
              days closed off, not attainment: Capricorn read them as progress and asked why they
              always agreed with "expected" (2026-08-18). They always did, and always would — the
              expected figure is by construction the cumulative share at the last complete day, i.e.
              the label printed under the last filled bar. The strip now says what it is, and the
              expected read is paired with the blended ACTUAL so the two can genuinely differ. */}
          <div className="card" style={{ flexDirection: "row", alignItems: "center", gap: 14, padding: "8px 14px" }}>
            <span className="card-title" style={{ marginBottom: 0, whiteSpace: "nowrap" }}>
              This Week{" "}
              <span className="card-sub">
                {shortDate(data.week.start)} – {shortDate(data.week.end)} · bars = days closed off
              </span>
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
              {data.week.pending ? (
                <>Awaiting this week&rsquo;s data · last day {shortDate(data.week.latestDay)}</>
              ) : (
                <>
                  Expected <b>{data.week.expectedPct}%</b>
                  {data.week.actualPct != null && <> · achieved <b>{data.week.actualPct}%</b></>}
                  {/* One decimal place, not signedPp's whole number: this is a BLENDED gap and sits
                      within a point or two most days, so rounding it turned a −0.3pp miss into an
                      amber "0pp" — a colour contradicting its own figure. */}
                  {data.week.gapPp != null && (
                    <>
                      {" "}
                      <span className={data.week.gapPp >= 0 ? "val-green" : "val-amber"}>
                        ({data.week.gapPp >= 0 ? "+" : "−"}{Math.abs(data.week.gapPp).toFixed(1)}pp)
                      </span>
                    </>
                  )}
                </>
              )}
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
                    {/* Each targeted column carries its own against-target read inline, rather than
                        the table having one "vs Target" column — a column of its own read as though
                        every measure were being judged, including the ones that aren't. Existing
                        Client Cases sits between New Clients and Written with no arrow: it has no
                        target, deliberately. */}
                    <td style={{ fontVariantNumeric: "tabular-nums" }}>
                      {num(o.leads)}
                      <PaceArrow pct={o.paceByKpi.leads.pct} expected={o.paceByKpi.leads.expected} actual={o.leads} noun="new clients" />
                    </td>
                    <td style={{ color: "var(--text-secondary)" }}>{num(o.existingCases)}</td>
                    <td style={{ fontVariantNumeric: "tabular-nums" }}>
                      {num(o.applications)}
                      <PaceArrow pct={o.paceByKpi.applications.pct} expected={o.paceByKpi.applications.expected} actual={o.applications} noun="written" />
                    </td>
                    <td style={{ fontVariantNumeric: "tabular-nums" }}>
                      {num(o.referrals)}
                      <PaceArrow pct={o.paceByKpi.referrals.pct} expected={o.paceByKpi.referrals.expected} actual={o.referrals} noun="referrals" />
                    </td>
                    <td style={{ fontVariantNumeric: "tabular-nums" }}>
                      {num(o.sales)}
                      <PaceArrow pct={o.paceByKpi.sales.pct} expected={o.paceByKpi.sales.expected} actual={o.sales} noun="sales" />
                    </td>
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
                  {/* Each all-offices arrow reuses that KPI's own expectedByNow rather than summing
                      the per-office expectations, so the footer and the matching card can never
                      disagree about what "expected" means. Same "at least one unit due" bar the rows
                      use, for the same reason — see paceByKpi on the server. */}
                  <TotalCell total={data.leaderboardTotals.leads} kpi={kpiByKey.get("leads")} noun="new clients" />
                  <td><b>{num(data.leaderboardTotals.existingCases)}</b></td>
                  <TotalCell total={data.leaderboardTotals.applications} kpi={kpiByKey.get("applications")} noun="written" />
                  <TotalCell total={data.leaderboardTotals.referrals} kpi={kpiByKey.get("referrals")} noun="referrals" />
                  <TotalCell total={data.leaderboardTotals.sales} kpi={kpiByKey.get("sales")} noun="sales" />
                  <td style={{ textAlign: "right", color: "var(--text-secondary)", fontSize: 11 }}>= card “week to date”</td>
                </tr>
              </tfoot>
            </table>
            {/* An upload can be a BLEND — the Datarails import supplies only Sales/Referrals/Revenue
                and leaves Leads/Applications at whatever they were — so the provenance note travels
                in the tooltip rather than being flattened into "Capricorn's targets" full stop. */}
            <div
              className="placeholder-note"
              style={{ marginTop: 6 }}
              title={
                placeholderTargets
                  ? "No target file has been uploaded — every target shown is derived from trailing averages, not Capricorn's own."
                  : [
                      meta.targetsProvenance.uploadedBy && `Uploaded by ${meta.targetsProvenance.uploadedBy}`,
                      meta.targetsProvenance.note,
                    ]
                      .filter(Boolean)
                      .join(" · ")
              }
            >
              {placeholderTargets
                ? "Targets are placeholder values pending Capricorn confirmation; "
                : `Targets from Capricorn's weekly upload${meta.targetsProvenance.effectiveWeek ? ` (week of ${shortDate(meta.targetsProvenance.effectiveWeek)})` : ""}; `}
              advisers without an office mapping show as Unassigned.
            </div>
          </div>
        </div>
      )}
    </Load>
  );
}
