// The navy Growth OS header: brand · page title + wall clock · WHICH DATA IS ON SCREEN.
//
// The right-hand block used to show today's date and a pulsing red "Live" badge. Both were untrue:
// the Growth OS reads a warehouse copy that reloads 4× daily, so the figures are never real-time and
// target comparisons run through the last complete day.
// Showing today's date next to yesterday's numbers, under the word "Live", is why Kyle asked three
// times whether the board was live (2026-07-28 → 08-03) and why a Monday view of Sunday's data read
// as broken. Per Conor's 2026-08-04 note — "every screen should clearly show its refresh frequency
// and a 'Data as at' timestamp" — the header now states the data date and the cadence, and the word
// "Live" is gone. The clock stays: it is the time now, labelled as such, not a claim about the data.
//
// The load time sits NEXT TO THE CLOCK (Capricorn 2026-08-17): "17:41 · data refreshed at 11:50" puts
// the two times side by side, so the gap between now and the data reads at a glance from across the
// room instead of needing the two ends of the header compared.
//
// ⚠ The "N weeks changed" pill was REMOVED on Capricorn's instruction (2026-08-17). It existed for a
// real reason: Sat 25–31 Jul reported £68,951 of protection on 4 Aug and £64,341.82 on 10 Aug, and the
// six days in between were spent telling Capricorn's CFO the first figure matched his report exactly
// while nothing on any screen said it had moved. The detection still runs and the Reconciliation
// screen still itemises every revision — what is gone is the passive warning on every OTHER screen.
// If a closed week silently moves again, nobody reading the wall learns it until they open that page.

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import capricornLogo from "../assets/logos/capricorn.svg";
import { clockTime } from "../format.js";
import type { TargetsProvenance } from "../types.js";

/** What the header says about the data on screen. */
export interface Freshness {
  /** Latest COMPLETE day the figures cover (YYYY-MM-DD) — the boundary target comparisons stop at,
   *  NOT the freshest data on the board. Today is on the board too; see `dataThrough`. */
  dataAsOf: string;
  /** The newest business day actually on the board — today once today has business loaded. THIS is
   *  what the stamp shows. Optional only so a caller that has not been updated still renders. */
  dataThrough?: string;
  /** Loads per day, from the server, so the count is not hardcoded in two places. */
  loadsPerDay?: number;
  /** ISO time of the lake's last load — the share reloads 4× daily, so this moves through the day. */
  lastRefreshAt?: string | null;
  /** Where the targets come from — a placeholder is called out, not hidden (Conor 2026-08-04). */
  targetsProvenance?: TargetsProvenance;
}

function asAtLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${days[d.getUTCDay()]} ${d.getUTCDate()} ${months[d.getUTCMonth()]}`;
}

function useClock(): string {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

export function GosHeader({ title, right, freshness, onTargetsClick }: {
  title: string;
  right?: ReactNode;
  /** Omitted only before meta loads — the stamp then reads "—" rather than guessing a date. */
  freshness?: Freshness;
  /** Dashboard only: jump to the Targets tab. Kyle clicked the placeholder pill expecting it to take
   *  him somewhere and nothing happened (2026-08-07) — a warning that names a fix should offer it. */
  onTargetsClick?: () => void;
}) {
  const time = useClock();
  const placeholderTargets = freshness?.targetsProvenance?.source === "placeholder";
  // Falls back to dataAsOf so an older caller, or a meta payload from before this field existed,
  // still stamps a real date rather than a blank.
  const through = freshness ? (freshness.dataThrough ?? freshness.dataAsOf) : undefined;
  const includesToday = through != null && freshness != null && through !== freshness.dataAsOf;
  const loads = freshness?.loadsPerDay ?? 4;
  return (
    <header className="gos-header">
      <div className="gos-brand">
        <img src={capricornLogo} alt="Capricorn Financial Group" className="gos-logo" />
      </div>
      <div className="gos-header-center">
        <div className="gos-title">{title}</div>
        <div className="gos-clock" title="Current time — not the data date">{time}</div>
        {/* Beside the clock on purpose: the useful fact is the DISTANCE between now and the last load,
            and that only reads as a distance when both times sit together. */}
        {freshness?.lastRefreshAt && (
          <div
            className="gos-refreshed"
            title="When the warehouse copy behind these figures was last loaded. It reloads 4× daily, so this moves through the day."
          >
            data refreshed at {clockTime(freshness.lastRefreshAt)}
          </div>
        )}
      </div>
      <div className="gos-header-right">
        {/* THE DATE ON THE BOARD, not the target-comparison boundary.
            This stamp showed `dataAsOf` — the last COMPLETE day — through 2026-08-24. Both "Data as at
            Sun 23 Aug" and its replacement "Complete to Sun 23 Aug" put yesterday's date at the top of
            a board that visibly holds today, and every reader drew the obvious conclusion: the refresh
            is broken. Kyle three times (2026-08-10, 08-21, 08-24), then Capricorn: "it is confusing
            saying yesterday's date — if we have refreshed on the day, make the date reflect that date."
            They were right, and the giveaway was the ticker three inches below already reading MON 24
            AUG off the same data.
            So the stamp now answers "how fresh is this?" with `dataThrough`, and the boundary — a real
            thing, but a reconciliation detail rather than a wall-at-twenty-feet one — moves to the
            tooltip and to the "COMPLETE" marker on each chase chart, which is where it bites. The load
            time itself sits next to the clock. */}
        <div
          className="gos-asat"
          title={`The newest day on this board. Today appears here as soon as any of today's business has loaded — as the dotted segment on each chase chart and the "today so far" figure beside each KPI. Target comparisons are a separate question and still stop at the last COMPLETE day${includesToday && freshness ? ` (${asAtLabel(freshness.dataAsOf)})` : ""}, because a part-day measured against a whole day's target reads as behind all morning and recovers by evening. The warehouse copy reloads ${loads}× daily.`}
        >
          <div className="gos-asat-value">Data to {through ? asAtLabel(through) : "—"}</div>
          <div className="gos-asat-cadence">
            {includesToday ? "incl. today so far · " : ""}refreshes {loads}× daily
          </div>
        </div>
        {/* Targets are config, and until Capricorn uploads their own they are OUR placeholders. A
            "vs target" that nobody can trace is exactly what generates the emails Conor wants to
            stop, so the board says so on its face rather than burying it on the Targets page. */}
        {placeholderTargets && (onTargetsClick ? (
          <button
            type="button"
            className="gos-warn-pill gos-warn-pill-btn"
            onClick={onTargetsClick}
            title="No target file has been uploaded — every target shown is a placeholder derived from trailing averages, not Capricorn's own. Click to open the Targets tab and upload the weekly workbook."
          >
            Targets: placeholder <span aria-hidden="true">→</span>
          </button>
        ) : (
          <div className="gos-warn-pill" title="No target file has been uploaded — targets shown are placeholders derived from trailing averages, not Capricorn's own targets.">
            Targets: placeholder
          </div>
        ))}
        {right}
      </div>
    </header>
  );
}
