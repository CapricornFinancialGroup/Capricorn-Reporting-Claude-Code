// Screen 1 — Weekly Run Chase (Conor's principles): one large chase chart per TARGETED measure, each
// carrying its own figure strip, plus the weekly progress indicator and the live-feed ticker.
//
// Restructured 2026-08-19 on Capricorn's instruction. It previously opened with five KPI tiles above
// four chase charts, which said the same thing twice — the tile's job was the current figures, the
// chart's job was the trend, and the tile was winning the argument for space. The tiles are gone, the
// charts are twice the size in a 2x2, and each one carries the tile's figures underneath it (see
// ChaseStats, which keeps the today-is-never-judged rule the tiles existed to protect).
//
// Charts are TARGETED measures only: a week chase drawn for a measure with no target would be an
// actual line against an empty pace line, which reads as catastrophically behind rather than as
// untargeted. That leaves Existing Client Cases with no chart and, now, no tile — so it rides along as
// the tracked companion on New Client Leads, the measure it is the other half of.
//
// The Office Leaderboard was removed from this screen the same day. Office-level chase is Screen 2's
// entire job (OfficeRunChase), which shows every office against every KPI rather than a table this
// page had to keep explaining the window of.

import { usePayload } from "../api.js";
import { paceChart } from "../charts.js";
import { ChaseStats, type TrackedCompanion } from "../components/ChaseStats.js";
import { EChart } from "../components/EChart.js";
import { StatusPill } from "../components/StatusPill.js";
import { Ticker } from "../components/Ticker.js";
import { shortDate, signed } from "../format.js";
import type { DailyRunChasePayload } from "../types.js";
import { Load, type PageProps } from "./common.js";

export function DailyRunChase({ meta, filters, mode, refreshMs }: PageProps) {
  const { data, error } = usePayload<DailyRunChasePayload>("daily-run-chase", filters, mode, refreshMs);
  // KPIs with a target, i.e. the ones a "week chase" chart can honestly be drawn for. Filtering on
  // `pace` rather than `targeted` also narrows the type, so the charts below need no non-null casts
  // beyond the ones TS still can't see through the closure.
  const chased = (data?.kpis ?? []).filter((k) => k.targeted && k.pace != null);

  // Existing Client Cases: tracked, untargeted, chartless. Attached to New Client Leads because they
  // are the two halves of the same intake — a case opened for a brand-new client vs one opened for a
  // client already on file (Capricorn 2026-08-17, "eg - Remos").
  const existing = (data?.kpis ?? []).find((k) => k.key === "existingCases");
  const companion: TrackedCompanion | null = existing
    ? {
        label: existing.label,
        today: data?.today ? (data.today.counts.existingCases ?? 0) : null,
        wtd: existing.wtd,
      }
    : null;

  // Which targets on screen are still OURS rather than Capricorn's. This caveat used to sit under the
  // leaderboard; it outlived the table because the point it makes — that no import route supplies a
  // Leads target — applies to the leads chart above it just as much.
  const placeholderTargets = meta.targetsProvenance.source === "placeholder";
  const unconfirmedLabels = (meta.targetsProvenance.unconfirmed ?? [])
    .map((k) => (data?.kpis ?? []).find((x) => x.key === k)?.label ?? k)
    .join(", ");

  return (
    <Load error={error} data={data}>
      {data && (
        <div className="screen">
          <Ticker mode={mode} refreshMs={refreshMs} />

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

          {/* 2x2 rather than 4-across: with the tiles and the leaderboard gone there is roughly four
              times the area to give each chart, and four tall narrow columns would have spent it all
              on height the pace lines don't need. `gridAutoRows: 1fr` so the two rows split the space
              evenly — grid rows default to sizing on content, which would let the row with the taller
              figure strip steal height from the other. */}
          <div className="row cols-2 grow" style={{ gridAutoRows: "1fr" }}>
            {chased.map((k) => (
              <div className="card" key={k.key}>
                <div className="card-title">
                  <span>{k.label} — week chase</span>
                  <StatusPill
                    status={k.pace!.status}
                    label={k.pace!.status === "on_pace" ? "On Pace" : `${k.pace!.status === "ahead" ? "Ahead" : "Behind"} ${signed(k.pace!.aheadBehind)}`}
                  />
                </div>
                <div className="chart-box">
                  <EChart
                    height={200}
                    option={paceChart({
                      days: k.chart.days,
                      actual: k.chart.actual,
                      targetPace: k.chart.targetPace,
                      projection: k.chart.projection,
                      behind: k.pace!.status === "behind",
                    })}
                  />
                </div>
                <ChaseStats
                  day={k.day}
                  weeklyTarget={k.weeklyTarget}
                  wtd={k.wtd}
                  today={data.today ? { count: data.today.counts[k.key] ?? 0, loadedAt: data.today.loadedAt } : null}
                  companion={k.key === "leads" ? companion : null}
                />
              </div>
            ))}
          </div>

          <div className="placeholder-note">
            {placeholderTargets
              ? "Targets are placeholder values pending Capricorn confirmation."
              : `Targets from Capricorn's weekly upload${meta.targetsProvenance.effectiveWeek ? ` (week of ${shortDate(meta.targetsProvenance.effectiveWeek)})` : ""}.`}
            {!placeholderTargets && unconfirmedLabels && (
              <> Except {unconfirmedLabels}, still our estimate pending confirmation.</>
            )}
            {" "}Office-level chase is on the next screen.
          </div>
        </div>
      )}
    </Load>
  );
}
