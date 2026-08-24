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
   *  NOT the freshest data on the board. Today is on the board too; see the header's own note. */
  dataAsOf: string;
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
        {/* "COMPLETE TO", not "DATA AS AT".
            The date here has always been the last COMPLETE day — the boundary target comparisons stop
            at — but "Data as at Sun 23 Aug" reads as "this is the newest data we hold", and on a Monday
            that reads as a board a day behind. Kyle asked whether the refresh was broken on that basis
            three times (2026-08-10, 08-21, 08-24), and since the intraday change on 2026-08-21 it is
            also plainly untrue: the board holds and shows today — the dotted segment on every chase
            chart, the "today so far" figure beside it, and the ticker's own date.
            So the label now names the boundary rather than implying a ceiling, and the second line says
            today is on here. The load time itself sits next to the clock. */}
        <div
          className="gos-asat"
          title="Two different things. The date is the last day treated as COMPLETE — target comparisons stop there, because a part-day measured against a whole day's target reads as behind all morning and recovers by evening. Today is not missing: it is on the board separately, as the dotted line on each chase chart and the 'today so far' figure, stamped with the load that produced it. The warehouse copy reloads 4× daily."
        >
          <div className="gos-asat-value">Complete to {freshness ? asAtLabel(freshness.dataAsOf) : "—"}</div>
          <div className="gos-asat-cadence">+ today so far · refreshes 4× daily</div>
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
