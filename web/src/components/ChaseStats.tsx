// The figure strip under a week-chase chart.
//
// Replaces the five KPI tiles that sat across the top of the Daily Run Chase until 2026-08-19. Their
// content is here instead, beneath the graph of the same measure — Capricorn's point being that the
// chart already carries the trend, so a tile repeating it above only cost the chart its height.
//
// IT KEEPS THE ONE DISTINCTION THE TILES EXISTED TO PROTECT.
//
//   TODAY SO FAR — a live part-day count, compared against the share of a day that is actually IN by
//                  this load, never against a whole day's target. That last comparison is the
//                  2026-07-30 bug which marked Capricorn down by a full day's target every morning
//                  and let them "recover" by evening.
//   LAST COMPLETE DAY — the only figure that can be judged against a whole day target, so it is the
//                  one that carries the day comparison, the gap and the pill, explicitly dated.
//
// Losing that separation is the single way this strip could do real damage, so the two figures are
// visually distinct and both are labelled with what they are.
//
// TODAY IS NOW JUDGED — carefully. It used to carry no comparison at all, which was safe and not what
// Capricorn wanted: "we should be reflecting the progress throughout the day" (2026-08-21). The thing
// that makes it possible is `recordedShare` (see dayRecordedShare): the ETL holds ~1.5% of a day at
// the morning load, 11% by lunchtime, 63% by the evening one. So the expectation today is measured
// against is the day's target × that share — what should be ON THE BOARD now, not what should have
// happened by close of play. Same number of hours on both sides of the comparison.

import { clockTime, num, shortDate, signed, statusLabel } from "../format.js";
import type { DayView } from "../types.js";
import { StatusPill } from "./StatusPill.js";

/** A tracked-but-untargeted companion measure, shown as a quiet second line.
 *
 *  CURRENTLY UNUSED, on purpose. It was built for Existing Client Cases — no target, so no chart, so
 *  removing the tiles would have deleted it from the board outright. Capricorn then ruled that the
 *  lead chase should read as new clients ONLY, and confirmed on 2026-08-19 that the objection is to
 *  that measure appearing as its own figure alongside Leads. So nothing passes a companion today.
 *
 *  Kept rather than deleted because the need it answers is real and recurring: the next tracked,
 *  untargeted measure will hit exactly the same problem. Do not re-attach one to Leads. */
export interface TrackedCompanion {
  label: string;
  today: number | null;
  wtd: number;
}

export function ChaseStats({ day, weeklyTarget, wtd, today, todayTarget, companion }: {
  day: DayView;
  weeklyTarget: number;
  wtd: number;
  /** Today's part-day count, the load that produced it, and the share of a day that load typically
   *  holds — the last of which is what lets today be compared with anything. */
  today?: { count: number; loadedAt: string | null; recordedShare: number | null } | null;
  /** TODAY's own day target. Must not be confused with `day.target`, which is the JUDGED day's — on a
   *  Monday that is Saturday's, roughly a third the size, and using it printed "+49 ahead" for a real
   *  "+21". Null withholds the comparison rather than guessing a denominator. */
  todayTarget?: number | null;
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

  // What should be recorded by now: TODAY's own day target scaled by the share of a day this load
  // holds. Withheld entirely when there is no share (no load stamp) or no target for today — a
  // verdict against an unknown denominator is worse than none. Rounded, and only shown once it
  // reaches 1: "0 of 0 expected" is noise, and at the first load a small KPI's expectation genuinely
  // is under one.
  //
  // `todayTarget`, NOT `dayTarget`. The latter belongs to the judged day — Saturday on a Monday — and
  // using it here was a straight bug: 62 leads against Saturday's 38×⅓ = 13 read as "+49 ahead" when
  // Monday's own 122×⅓ = 41 makes it "+21". See the note in datasets.ts.
  const todayExpected =
    today && today.recordedShare != null && todayTarget != null && todayTarget > 0
      ? Math.round(todayTarget * today.recordedShare)
      : null;
  const todayGap = today && todayExpected != null ? today.count - todayExpected : null;
  const todayGapClass = todayGap == null ? "" : todayGap > 0 ? "val-green" : todayGap < 0 ? "val-amber" : "val-blue";

  return (
    <div className="chase-stats">
      <div className="chase-stats-row">
        {/* Today. Deliberately first and largest: at 20:00 on a Monday the complete day is Sunday, and
            putting a stale zero weekend in the biggest type is what had Kyle reading the board as
            broken (2026-08-10). */}
        <div className="chase-stat">
          <div className="chase-stat-label">
            Today so far{todayExpected != null && todayExpected >= 1 ? " · vs recorded pace" : ""}
          </div>
          <div
            className="chase-stat-big"
            title={
              todayExpected != null && todayExpected >= 1
                ? `A running count from the most recent load. Compared with what should be RECORDED by now — the day's target scaled by the share of a day the data share typically holds at this load (about 1.5% at the morning load, 11% by lunchtime, 63% by the evening one). It is NOT compared with the whole day's target: a part-day against a full day reads as behind all morning and recovers by evening.`
                : "A running count from the most recent data load. No comparison yet — at this load the share of a day that has reached the data warehouse is too small for the expectation to be worth printing."
            }
          >
            {today ? num(today.count) : "—"}
            {todayExpected != null && todayExpected >= 1 && (
              <span className="chase-stat-vs">
                {" "}vs {num(todayExpected)} <span className={todayGapClass}>{signed(todayGap ?? 0)}</span>
              </span>
            )}
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
            // The gap is appended only when there IS one. chaseStatus returns "ahead" at ratio >= 1,
            // so hitting a day target exactly used to render "AHEAD 0" — a label arguing with its own
            // number. The green is right (the target was met); the "0" was the only wrong part.
            label={`${shortDate(day.date)}: ${statusLabel(day.status!)}${dayGap !== 0 && (day.status === "ahead" || day.status === "behind") ? ` ${signed(dayGap)}` : ""}`}
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
