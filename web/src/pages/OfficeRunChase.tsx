// Screen 2 — Office Run Chase: a card per office (rank, 4 KPI rows, mini %-to-pace chart), with a
// champion celebration on the leader.
//
// The ranking strip that used to sit beneath was removed on 2026-08-19 (Capricorn): it re-stated as
// bars the "% of pace" every tile already shows, and it was spending the height the six tiles need to
// be legible across an office. Rank moved ONTO the tile rather than being dropped — the tiles are in
// fixed office order, so without it nothing on the screen said who was first, and the header's
// "ranked #1-N by pace" would have been describing a strip that no longer existed.

import { usePayload } from "../api.js";
import { NO_VERDICT_GREY, pctPaceChart, STATUS_COLOR } from "../charts.js";
import { EChart } from "../components/EChart.js";
import { MetricInfo } from "../components/MetricInfo.js";
import { StatusPill } from "../components/StatusPill.js";
import { Ticker } from "../components/Ticker.js";
import { num, shortDate, signed } from "../format.js";
import type { OfficeRunChasePayload } from "../types.js";
import { Load, type PageProps } from "./common.js";

const KPI_SHORT: Record<string, string> = {
  leads: "LEADS",
  applications: "APPS",
  referrals: "REFS",
  sales: "SALES",
};

export function OfficeRunChase({ meta, filters, mode, refreshMs }: PageProps) {
  const { data, error } = usePayload<OfficeRunChasePayload>("office-run-chase", filters, mode, refreshMs);
  return (
    <Load error={error} data={data}>
      {data && (
        <div className="screen">
          {/* One ticker across every rotating screen, not just the first — Kyle, 2026-08-21: "please
              can the ticker be across all the screens as it rotates." It is the only element on the
              wall that reads as alive; a viewer who walks up during Office Run Chase or the League
              should see the same live feed the Daily Run Chase has. Same component, same payload,
              cached once per refresh, so four copies cost one query. */}
          <Ticker mode={mode} refreshMs={refreshMs} />
          {/* ONE LINE, not a title card above a definitions strip.
              The card that used to sit here held the words "% to Weekly Target Pace", a wide gap, and
              a right-aligned as-of stamp. Capricorn, 2026-08-20: "we have a thing at the top that says
              percent to weekly target pace, but then it has a big space. I think we need to look at
              whether that is actually providing us any real information." Mostly it was not — the page
              is titled by the wall header and by the dashboard nav, and "data as of" is already stamped
              in the app header. What was worth keeping is the week and the expected %, which is the bar
              every tile is judged against, so those move to the right of this line. Two rows of
              chrome become one, and the height goes to the six tiles.

              The definitions live here rather than as an ⓘ on all 4 KPIs × every office card — same
              reach, without 28 triggers competing with the numbers. */}
          <div className="funnel-defs office-defs">
            {[["leads", "Leads"], ["applications", "Mortgages Written"], ["referrals", "Protection Referrals"],
              ["sales", "Protection Sales"], ["pace", "% of Pace"]].map(([key, label]) => (
              <span className="funnel-def" key={key}>{label} <MetricInfo metricKey={key} mode={mode} /></span>
            ))}
            <span className="asof" style={{ marginLeft: "auto", whiteSpace: "nowrap" }}>
              Week {shortDate(data.week.start)} – {shortDate(data.week.end)} · expected <b>{data.week.expectedPct}%</b> · rank #1–{data.offices.length} by pace on each tile
            </span>
          </div>

          <div className="row cols-3 grow" style={{ gridAutoRows: "1fr" }}>
            {data.offices.map((o) => {
              const champion = o.office === data.champion;
              return (
                <div key={o.office} className={`card office-card ${champion ? "champion" : ""}`}>
                  {champion && <div className="leading-badge">Leading</div>}
                  <div className="office-head">
                    {/* Rank ahead of the name, because the tiles are in fixed office order — the
                        position is the one thing the layout itself cannot tell you. Blank rather than
                        "—" for an office with no target: there is no rank to hold. */}
                    {o.rank != null && <span className="office-rank">{o.rank}</span>}
                    <span className="office-title">{o.office}</span>
                    {o.pct != null ? <StatusPill status={o.status} label={`${o.pct}% of pace`} /> : <span className="pill muted">No target</span>}
                  </div>
                  <div className="office-kpis">
                    {o.kpis.map((k) => {
                      const fillPct = k.target > 0 ? Math.min(100, Math.round((k.actual / k.target) * 100)) : 0;
                      // No status = the week expects under one whole unit here, so there is no
                      // honest verdict to paint. Show the count against the target in grey and say
                      // why in one word, rather than colouring 0/1 red or 1/1 green.
                      const colour = k.status ? STATUS_COLOR[k.status] : NO_VERDICT_GREY;
                      return (
                        <div className="office-kpi" key={k.key}>
                          <span className="office-kpi-label">{KPI_SHORT[k.key]}</span>
                          <span className="office-kpi-val">{num(k.actual)}/{num(k.target)}</span>
                          <div className="progress-bar-bg">
                            <div className="progress-bar-fill" style={{ width: `${fillPct}%`, background: colour }} />
                          </div>
                          <span className="office-kpi-gap" style={{ color: colour }}>
                            {/* Short enough not to clip the column — "target too small to pace" ran
                                off the card edge as "target too small to pac". The reason lives on
                                the "% of Pace" ⓘ in the strip above, once, instead of in six
                                truncated copies. */}
                            {k.status == null
                              ? "no verdict"
                              : k.status === "on_pace"
                                ? "on pace"
                                : `${signed(k.gap)} vs exp.`}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  {/* A PREFERRED height, flexed down inside the card (see EChart). 110 was costing
                      the DASHBOARD its graphs: `.dash-main` is not a flex column, so the page is only
                      as tall as its content and `.chart-box` has no slack to hand the canvas — it
                      drew at exactly 110px while 368px of the window sat empty below the page. The
                      wall was never affected (its cards are 477px and give the chart 320 regardless),
                      which is why "the graphs at the bottom … look very small" (Capricorn 2026-08-20)
                      is true on one surface and not the other. 220 doubles the dashboard graph and
                      still leaves the page inside a 1080 window; the wall is unchanged. */}
                  <div className="chart-box" style={{ minHeight: 150 }}>
                    <EChart
                      height={220}
                      option={pctPaceChart({
                        days: o.chart.days,
                        actualPct: o.chart.actualPct,
                        targetPct: o.chart.targetPct,
                        color: STATUS_COLOR[o.status],
                      })}
                    />
                  </div>
                  {/* Unassigned isn't a place — it's advisers we have no office on file for. Naming
                      them makes the row actionable: Capricorn read the list and tell us where each
                      one belongs. Kyle asked "what the 19 unassigned related to?" (2026-08-06). */}
                  {o.members && o.members.length > 0 && (
                    <div className="office-members" title="These advisers have no office recorded in the dashboard's mapping, so their business lands here instead of in their real office. Send us the office for each and they move.">
                      No office on file:{" "}
                      {o.members.slice(0, 6).map((m) => `${m.name} (${m.leads})`).join(", ")}
                      {o.members.length > 6 && ` +${o.members.length - 6} more`}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* The Ranking Strip was removed on 2026-08-19 (Capricorn): it re-stated, as bars, the
              "% of pace" pill each tile already carries, and it was costing the six tiles the height
              they need to be read across an office. Rank moved onto the tiles rather than going with it.

              Its provenance line survives as this footnote. It follows `targetsProvenance` rather than
              being hardcoded (it was, and had been false since Kyle's first upload on 2026-08-13). */}
          <div className="placeholder-note">
            {meta.targetsProvenance.source === "placeholder"
              ? "Targets are placeholder values pending Capricorn confirmation."
              : `Targets from Capricorn's weekly upload${meta.targetsProvenance.effectiveWeek ? ` (week of ${shortDate(meta.targetsProvenance.effectiveWeek)})` : ""}.`}
          </div>
        </div>
      )}
    </Load>
  );
}
