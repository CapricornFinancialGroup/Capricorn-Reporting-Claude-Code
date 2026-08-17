// Screen-1 KPI card.
//
// TWO NUMBERS, AND WHICH ONE IS BIG MATTERS.
//
//   TODAY SO FAR — a live part-day count. Carries no target, no gap, no status pill, ever. Comparing
//                  four hours of a day against a whole day's target is the 2026-07-30 bug that
//                  marked Capricorn down by a full day's target every day.
//   LAST COMPLETE DAY — the only figure that can honestly be judged against a day target, so it
//                  keeps the gap, the progress bar and the pill.
//
// Until 2026-08-11 the complete day was always the headline and today sat in 9pt at the bottom. At
// 20:24 on a Monday that put a stale, zero, weekend Sunday in the biggest type on the board, with a
// red CRITICAL flag, while Monday's 100 leads were a footnote. Kyle read that as the board being
// broken — "how can it be refreshing when the data stays the same" (2026-08-10) — and he was right
// to. Every figure was correct; the layout was making the wrong one loud.
//
// So once today has activity it takes the headline, unjudged, and the complete day moves down to a
// line that still carries its target, its gap and its pill. Nothing about the target maths changed.
//
// UNTARGETED KPIs (`targeted: false`, e.g. Existing Client Cases) are TRACKED, not chased: same card,
// same figures, but no day target, no gap, no progress bar and no status pill. They must not borrow a
// verdict — every status helper reads "expected 0, actual > 0" as AHEAD, so a target-less KPI paced
// against zero would sit on the wall permanently green for beating nothing.

import type { Mode } from "../api.js";
import { MetricInfo } from "./MetricInfo.js";
import type { DayView } from "../types.js";
import { clockTime, num, shortDate, signed, statusLabel } from "../format.js";
import { StatusPill } from "./StatusPill.js";

export function KpiCard({ name, day, weeklyTarget, wtd, today, metricKey, mode, targeted = true }: {
  name: string;
  day: DayView;
  weeklyTarget: number;
  wtd: number;
  /** False = no target set for this KPI: show the counts, withhold every judgement. */
  targeted?: boolean;
  /** Today's part-day count + the load that produced it. Omitted at weekends and before meta loads. */
  today?: { count: number; loadedAt: string | null } | null;
  /** Key into the metric dictionary — renders the clickable definition (Conor 2026-08-04). */
  metricKey?: string;
  mode?: Mode;
}) {
  // Narrowed once, here, so the render below can treat "judged" as a single condition.
  const judged = targeted && day.target != null && day.status != null;
  const dayTarget = day.target ?? 0;
  const dayGap = day.gap ?? 0;
  const pctOfDay = judged && dayTarget > 0 ? Math.min(100, (day.actual / dayTarget) * 100) : 0;
  const gapClass = dayGap > 0 ? "val-green" : dayGap < 0 ? "val-amber" : "val-blue";
  const wtdPct = weeklyTarget > 0 ? Math.round((wtd / weeklyTarget) * 100) : 0;
  // Today leads only once something has actually happened. A headline "Today so far 0" at 08:00 is
  // no more use than a stale Sunday, so before the first activity the complete day keeps the top.
  const live = today != null && today.count > 0;
  // The card's coloured edge follows whatever number is in the headline. A red CRITICAL border
  // driven by Sunday, sitting above a healthy live Monday, is exactly the contradiction above.
  // Untargeted cards take a neutral edge: the coloured border IS a verdict.
  const cardState = live ? "live" : judged ? day.status : "tracked";

  return (
    <div className={`card kpi-card ${cardState}`}>
      <div className="kpi-name">
        {name}{" "}
        <span className="card-sub" style={{ letterSpacing: "0.04em" }}>
          · {live ? "today" : shortDate(day.date)}
        </span>
        {metricKey && mode && <> <MetricInfo metricKey={metricKey} mode={mode} /></>}
      </div>
      <div className="kpi-main-row">
        <div className="kpi-current">{num(live ? today!.count : day.actual)}</div>
        <div className="kpi-target-block">
          <div className="kpi-target-label">{live ? "As at" : judged ? "Day target" : "Tracked"}</div>
          <div className="kpi-target-val">
            {live ? (today!.loadedAt ? clockTime(today!.loadedAt) : "—") : judged ? num(dayTarget) : "—"}
          </div>
        </div>
      </div>
      {/* The judged figure. When today is live this is the row that carries the target comparison,
          clearly dated, so the two are never confused for one another. */}
      {live && (
        <div
          className="kpi-lastday"
          title="The most recent day that has FINISHED. Target comparisons use complete days only — a part-day measured against a whole day's target would read as behind all morning and recover by evening."
        >
          <span className="kpi-lastday-label">{shortDate(day.date)} (complete)</span>
          <span className="kpi-lastday-val">
            <b>{num(day.actual)}</b>
            {judged && <> vs target {num(dayTarget)} <span className={gapClass}>{signed(dayGap)}</span></>}
          </span>
        </div>
      )}
      <div className="kpi-stats-row">
        <div className="kpi-stat">
          <div className="kpi-stat-label">{live || !judged ? "Last full day" : "Vs day target"}</div>
          <div className={`kpi-stat-value ${live || !judged ? "" : gapClass}`}>
            {live || !judged ? num(day.actual) : signed(dayGap)}
          </div>
        </div>
        <div className="kpi-stat">
          <div className="kpi-stat-label">Week to date</div>
          <div className="kpi-stat-value">{num(wtd)}</div>
        </div>
        <div className="kpi-stat">
          <div className="kpi-stat-label">{judged ? "Wk target" : "No target set"}</div>
          <div className="kpi-stat-value" style={{ color: "rgba(30,41,59,0.45)" }}>
            {judged ? num(weeklyTarget) : "—"}
          </div>
        </div>
      </div>
      {judged && (
        <div className="progress-wrap">
          <div className="progress-labels">
            <span>Day {Math.round(pctOfDay)}%</span>
            <span>Week {wtdPct}%</span>
          </div>
          <div className="progress-bar-bg">
            <div className="progress-bar-fill" style={{ width: `${pctOfDay}%` }} />
          </div>
        </div>
      )}
      <div className="kpi-footer">
        {today && !live && (
          <span
            className="kpi-today"
            title="Today is still in progress, so it is NOT in the figures above — those measure complete days only. This is a running count from the most recent data load."
          >
            Today so far <b>{num(today.count)}</b>
            {today.loadedAt && <span className="kpi-today-age"> · {clockTime(today.loadedAt)}</span>}
          </span>
        )}
        {live && (
          <span className="kpi-today" title="Today is in progress and is not judged against a target — the pill refers to the last complete day.">
            live · updates through the day
          </span>
        )}
        {judged ? (
          <StatusPill
            status={day.status!}
            label={`${live ? `${shortDate(day.date)}: ` : ""}${statusLabel(day.status!)}${day.status === "ahead" || day.status === "behind" ? ` ${signed(dayGap)}` : ""}`}
          />
        ) : (
          <span className="kpi-today" title="Capricorn have not set a target for this measure, so it is reported and trended but never judged ahead or behind.">
            tracked · no target
          </span>
        )}
      </div>
    </div>
  );
}
