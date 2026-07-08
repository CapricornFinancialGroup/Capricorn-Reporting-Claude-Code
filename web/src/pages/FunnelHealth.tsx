// Screen 4 — Funnel Health: tapering funnel chart + applications-vs-referrals gap chart.
// Stage Metrics, Active Alerts and Cases Awaiting Action were removed (Luke, 2026-07-08) — the
// funnel + gap chart carry the screen's whole story now.

import { usePayload } from "../api.js";
import { applicationsReferralsGapChart, funnelStagesChart } from "../charts.js";
import { CompareStrip } from "../components/CompareStrip.js";
import { EChart } from "../components/EChart.js";
import { num, shortDate } from "../format.js";
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
              <span>Applications vs Referrals</span>
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
