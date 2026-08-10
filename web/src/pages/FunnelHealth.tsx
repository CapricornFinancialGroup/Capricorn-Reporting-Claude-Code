// Screen 4 — Funnel Health: tapering funnel chart + applications-vs-referrals gap chart.
// Stage Metrics, Active Alerts and Cases Awaiting Action were removed (Luke, 2026-07-08) — the
// funnel + gap chart carry the screen's whole story now.

import { usePayload } from "../api.js";
import { applicationsReferralsGapChart, funnelStagesChart } from "../charts.js";
import { CompareStrip } from "../components/CompareStrip.js";
import { EChart } from "../components/EChart.js";
import { MetricInfo } from "../components/MetricInfo.js";
import { longDate, num, shortDate } from "../format.js";
import type { FunnelHealthPayload } from "../types.js";
import { Load, type PageProps } from "./common.js";

/** Share-of-leads % is meaningless on tiny denominators — show "–" instead. */
const MIN_DENOMINATOR = 10;

export function FunnelHealth({ filters, compareFilters, mode, refreshMs }: PageProps) {
  const { data, error } = usePayload<FunnelHealthPayload>("funnel-health", filters, mode, refreshMs);
  const { data: compareData } = usePayload<FunnelHealthPayload>("funnel-health", compareFilters ?? null, mode, refreshMs);
  return (
    <Load error={error} data={data}>
      {data && (
        <div className="screen">
          {/* THIS SCREEN COVERS A DIFFERENT PERIOD FROM THE OTHERS, AND THAT HAS TO BE UNMISSABLE.
              Kyle, 2026-08-10: "This screens data cannot be correct? Please investigate. Health
              Funnel is completely disconnected to the other screens." It showed 722 leads while
              Market Momentum showed 43 — because the funnel runs month to date and the run-chase
              screens run the current week. Both were right. The period WAS printed, in eight-point
              grey inside the card title, which is the same as not printing it: this is the "a full
              week read as three days" failure of 28 July repeating on a screen I hadn't re-checked.
              A funnel needs the longer window (offers lag written business by weeks), so the window
              stays and the label gets loud instead. */}
          <div className="funnel-window">
            <span className="funnel-window-period">
              {longDate(data.window.from)} – {longDate(data.window.to)}
            </span>
            <span className="funnel-window-note">
              Month to date — deliberately a longer window than the run-chase and Momentum screens,
              which show the current week. Offers arrive weeks after the business is written, so a
              one-week funnel would show a collapse that isn't there. These figures will not match
              the weekly screens and are not meant to.
            </span>
          </div>
          <div className="card">
            <div className="card-title">
              <span>Sales Pipeline — where is revenue getting stuck? <span className="card-sub">gross stage volumes {shortDate(data.window.from)} – {shortDate(data.window.to)} · % = share of period leads, not case-by-case conversion</span></span>
              <span className="asof">Data as of {shortDate(data.dataAsOf)}</span>
            </div>
            <EChart
              height={280}
              option={funnelStagesChart(
                data.stages.map((s, i) => {
                  const leadsCount = data.stages[0]?.count ?? 0;
                  const pct = i === 0 ? 100 : (data.conversions[i - 1]?.pct ?? 0);
                  const pctText = leadsCount >= MIN_DENOMINATOR ? `${pct}%` : "–";
                  return { name: s.label, value: s.count, label: `${s.label}\n${num(s.count)} · ${pctText}` };
                }),
              )}
            />
            {/* The funnel itself is a chart, so the stage definitions hang off a strip beneath it —
                every stage still clickable through to its single definition (Conor 2026-08-04). */}
            <div className="funnel-defs">
              {data.stages.map((st) => (
                <span className="funnel-def" key={st.key}>
                  {st.label} <MetricInfo metricKey={st.key} mode={mode} />
                </span>
              ))}
            </div>
          </div>

          {compareFilters && compareData && (
            <CompareStrip
              primaryLabel={`${shortDate(data.window.from)} – ${shortDate(data.window.to)}`}
              compareLabel={`${shortDate(compareData.window.from)} – ${shortDate(compareData.window.to)}`}
              rows={data.stages.map((s, i) => ({
                label: s.label,
                primary: s.count,
                compare: compareData.stages[i]?.count ?? null,
                fmt: "int",
              }))}
            />
          )}

          <div className="card grow">
            <div className="card-title">
              <span>Mortgages Written vs Referrals</span>
              <span className="card-sub">the gap is the unreferred opportunity · indicative</span>
            </div>
            <div className="grow">
              <EChart height={560} option={applicationsReferralsGapChart(data.applicationsReferralsGap)} />
            </div>
          </div>
        </div>
      )}
    </Load>
  );
}
