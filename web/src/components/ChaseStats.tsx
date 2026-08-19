// The figure strip under a week-chase chart.
//
// Replaces the five KPI tiles that sat across the top of the Daily Run Chase until 2026-08-19. Their
// content is here instead, beneath the graph of the same measure — Capricorn's point being that the
// chart already carries the trend, so a tile repeating it above only cost the chart its height.
//
// IT KEEPS THE ONE DISTINCTION THE TILES EXISTED TO PROTECT.
//
//   TODAY SO FAR — a live part-day count. No target, no gap, no verdict, ever. Comparing four hours
//                  against a whole day's target is the 2026-07-30 bug that marked Capricorn down by a
//                  full day's target every morning and let it "recover" by evening.
//   LAST COMPLETE DAY — the only figure that can honestly be judged against a day target, so it is
//                  the one that carries the comparison, the gap and the pill, explicitly dated.
//
// Losing that separation is the single way this strip could do real damage, so the two figures are
// visually distinct and both are labelled with what they are.

import { clockTime, num, shortDate, signed, statusLabel } from "../format.js";
import type { DayView } from "../types.js";
import { StatusPill } from "./StatusPill.js";

/** A tracked-but-untargeted companion measure, shown as a quiet second line. Exists for Existing
 *  Client Cases: it has no target, so it gets no chart, so removing the tiles would have deleted it
 *  from the board outright — and Capricorn asked for it explicitly on 2026-08-17. */
export interface TrackedCompanion {
  label: string;
  today: number | null;
  wtd: number;
}

export function ChaseStats({ day, weeklyTarget, wtd, today, companion }: {
  day: DayView;
  weeklyTarget: number;
  wtd: number;
  /** Today's part-day count + the load that produced it. Null at weekends and before meta loads. */
  today?: { count: number; loadedAt: string | null } | null;
  companion?: TrackedCompanion | null;
}) {
  // This strip is only rendered under a chase chart, i.e. for a TARGETED measure, so a missing target
  // here is a data fault rather than an untargeted KPI. Guarded anyway: better a withheld verdict
  // than an invented one.
  const judged = day.target != null && day.status != null;
  const dayTarget = day.target ?? 0;
  const dayGap = day.gap ?? 0;
  const gapClass = dayGap > 0 ? "val-green" : dayGap < 0 ? "val-amber" : "val-blue";
  const wtdPct = weeklyTarget > 0 ? Math.round((wtd / weeklyTarget) * 100) : 0;

  return (
    <div className="chase-stats">
      <div className="chase-stats-row">
        {/* Today, unjudged. Deliberately first and largest: at 20:00 on a Monday the complete day is
            Sunday, and putting a stale zero weekend in the biggest type is what had Kyle reading the
            board as broken (2026-08-10). */}
        <div className="chase-stat">
          <div className="chase-stat-label">Today so far</div>
          <div className="chase-stat-big" title="Today is still in progress, so it is NOT judged against any target — those comparisons use complete days only. A running count from the most recent data load.">
            {today ? num(today.count) : "—"}
            {today?.loadedAt && <span className="chase-stat-age"> · {clockTime(today.loadedAt)}</span>}
          </div>
        </div>

        {/* The judged day, clearly dated so it can never be read as today. */}
        <div className="chase-stat">
          <div className="chase-stat-label">{shortDate(day.date)} (complete)</div>
          <div
            className="chase-stat-big"
            title="The most recent day that has FINISHED. Target comparisons use complete days only — a part-day measured against a whole day's target reads as behind all morning."
          >
            {num(day.actual)}
            {judged && (
              <span className="chase-stat-vs">
                {" "}vs {num(dayTarget)} <span className={gapClass}>{signed(dayGap)}</span>
              </span>
            )}
          </div>
        </div>

        <div className="chase-stat">
          <div className="chase-stat-label">Week to date</div>
          <div className="chase-stat-big">
            {num(wtd)}
            {weeklyTarget > 0 && (
              <span className="chase-stat-vs"> of {num(weeklyTarget)} · {wtdPct}%</span>
            )}
          </div>
        </div>

        {judged && (
          <StatusPill
            status={day.status!}
            label={`${shortDate(day.date)}: ${statusLabel(day.status!)}${day.status === "ahead" || day.status === "behind" ? ` ${signed(dayGap)}` : ""}`}
          />
        )}
      </div>

      {companion && (
        <div className="chase-stats-companion" title="Tracked, not chased: Capricorn have set no target for this measure, so it is reported and trended but never judged ahead or behind.">
          {companion.label}: <b>{companion.today == null ? "—" : num(companion.today)}</b> today ·{" "}
          <b>{num(companion.wtd)}</b> week to date <span className="chase-stat-age">· tracked, no target</span>
        </div>
      )}
    </div>
  );
}
