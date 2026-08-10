// The navy Growth OS header: brand · page title + wall clock · WHICH DATA IS ON SCREEN.
//
// The right-hand block used to show today's date and a pulsing red "Live" badge. Both were untrue:
// the Growth OS reads a warehouse copy that reloads 5× daily, so the figures are never real-time and
// target comparisons run through the last complete day.
// Showing today's date next to yesterday's numbers, under the word "Live", is why Kyle asked three
// times whether the board was live (2026-07-28 → 08-03) and why a Monday view of Sunday's data read
// as broken. Per Conor's 2026-08-04 note — "every screen should clearly show its refresh frequency
// and a 'Data as at' timestamp" — the header now states the data date and the cadence, and the word
// "Live" is gone. The clock stays: it is the time now, labelled as such, not a claim about the data.

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import capricornLogo from "../assets/logos/capricorn.svg";
import { clockTime } from "../format.js";
import type { TargetsProvenance } from "../types.js";

/** What the header says about the data on screen. */
export interface Freshness {
  /** Latest COMPLETE day the figures cover (YYYY-MM-DD). */
  dataAsOf: string;
  /** ISO time of the lake's last load — the share reloads 5× daily, so this moves through the day. */
  lastRefreshAt?: string | null;
  /** Where the targets come from — a placeholder is called out, not hidden (Conor 2026-08-04). */
  targetsProvenance?: TargetsProvenance;
  /** Closed weeks whose figures have moved in a way late data entry doesn't explain. */
  revisedWeeks?: number;
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

export function GosHeader({ title, right, freshness, onTargetsClick, onRevisionsClick }: {
  title: string;
  right?: ReactNode;
  /** Omitted only before meta loads — the stamp then reads "—" rather than guessing a date. */
  freshness?: Freshness;
  /** Dashboard only: jump to the Targets tab. Kyle clicked the placeholder pill expecting it to take
   *  him somewhere and nothing happened (2026-08-07) — a warning that names a fix should offer it. */
  onTargetsClick?: () => void;
  /** Dashboard only: jump to Reconciliation, where the movement is itemised. */
  onRevisionsClick?: () => void;
}) {
  const time = useClock();
  const placeholderTargets = freshness?.targetsProvenance?.source === "placeholder";
  const revised = freshness?.revisedWeeks ?? 0;
  return (
    <header className="gos-header">
      <div className="gos-brand">
        <img src={capricornLogo} alt="Capricorn Financial Group" className="gos-logo" />
      </div>
      <div className="gos-header-center">
        <div className="gos-title">{title}</div>
        <div className="gos-clock" title="Current time — not the data date">{time}</div>
      </div>
      <div className="gos-header-right">
        <div className="gos-asat" title="Target comparisons measure through the last complete day; the data itself reloads 5× daily.">
          <div className="gos-asat-value">Data as at {freshness ? asAtLabel(freshness.dataAsOf) : "—"}</div>
          <div className="gos-asat-cadence">
            {freshness?.lastRefreshAt
              ? `Loaded ${clockTime(freshness.lastRefreshAt)} · refreshes 5× daily`
              : "Refreshes 5× daily · not real-time"}
          </div>
        </div>
        {/* A CLOSED week has changed its figures. This has to be visible from wherever a number is
            read, not only on the audit screen: Sat 25-31 Jul reported £68,951 of protection on 4 Aug
            and £64,341.82 on 10 Aug, and the six days in between were spent telling Capricorn's CFO
            the first figure matched his report exactly. Nothing on any screen said otherwise. */}
        {revised > 0 && (
          onRevisionsClick ? (
            <button
              type="button"
              className="gos-warn-pill gos-warn-pill-alert gos-warn-pill-btn"
              onClick={onRevisionsClick}
              title="A week that had already closed is reporting different figures than when it was first recorded. Click to see which week, by how much, and whether business was added or removed."
            >
              {revised} week{revised === 1 ? "" : "s"} changed <span aria-hidden="true">→</span>
            </button>
          ) : (
            <div
              className="gos-warn-pill gos-warn-pill-alert"
              title="A week that had already closed is reporting different figures than when it was first recorded."
            >
              {revised} week{revised === 1 ? "" : "s"} changed
            </div>
          )
        )}
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
