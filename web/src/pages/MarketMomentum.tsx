// Screen 5 — Market Momentum: "is the business improving?" — 13-week trends with deltas vs last
// week and the quarter average, plus the verdict bar.

import { usePayload } from "../api.js";
import { AMBER, BLUE, momentumChart, momentumForecastChart, NAVY } from "../charts.js";
import { CompareStrip } from "../components/CompareStrip.js";
import { EChart } from "../components/EChart.js";
import { MetricInfo } from "../components/MetricInfo.js";
import { gbpCompact, num, shortDate } from "../format.js";
import type { MarketMomentumPayload, MomentumKpi } from "../types.js";
import type { Mode } from "../api.js";
import { Load, type PageProps } from "./common.js";

function fmtOne(k: MomentumKpi, v: number | null): string {
  if (v == null) return "—";
  return k.fmt === "gbpk" || k.fmt === "gbp" ? gbpCompact(v) : num(Math.round(v));
}

function fmtValue(k: MomentumKpi): string {
  return fmtOne(k, k.latest);
}

function fmtDelta(k: MomentumKpi): { text: string; cls: string } {
  if (k.delta == null || k.deltaPct == null) return { text: "no prior week", cls: "delta-flat" };
  const sign = k.delta >= 0 ? "+" : "−";
  const d = k.fmt === "int" ? Math.abs(Math.round(k.delta)).toString() : gbpCompact(Math.abs(k.delta));
  return {
    text: `${sign}${d} (${sign}${Math.abs(k.deltaPct * 100).toFixed(1)}%)`,
    cls: k.delta >= 0 ? "delta-up" : "delta-down",
  };
}

/** The tile's window in words. These tiles report the LAST COMPLETE Sat–Fri week while the run-chase
 *  screens report the current one; showing only "W30" let a full week be read as three days and
 *  reconciled against a report sharing none of its days (Kyle 2026-07-28). Spell out the dates. */
function windowLabel(k: MomentumKpi): string {
  return `${shortDate(k.weekFrom)} – ${shortDate(k.weekTo)}`;
}

export function MarketMomentum({ filters, compareFilters, mode, refreshMs }: PageProps) {
  const { data, error } = usePayload<MarketMomentumPayload>("market-momentum", filters, mode, refreshMs);
  const { data: compareData } = usePayload<MarketMomentumPayload>("market-momentum", compareFilters ?? null, mode, refreshMs);
  return (
    <Load error={error} data={data}>
      {data && (
        <div className="screen">
          <div className="row" style={{ gridTemplateColumns: "repeat(5, 1fr)" }}>
            {data.kpis.map((k) => {
              const d = fmtDelta(k);
              return (
                <div className="card mom-kpi" key={k.key}>
                  <div className="mom-kpi-label">{k.label} <MetricInfo metricKey={k.key} mode={mode} /></div>
                  {/* The CURRENT week leads, compared with the prior week to the same weekday —
                      Kyle, 2026-08-07: "I'd have current week i.e. WK32 compared to WK31 … so we can
                      track if we are performing better than the prior week." Both sides are
                      truncated to the same day so a Tuesday isn't measured against a full Friday. */}
                  <div className="mom-kpi-window">
                    {k.likeForLike ? `${k.weekLabel} to ${shortDate(k.throughDay)}` : `${k.weekLabel} · ${windowLabel(k)}`}
                    {k.provisional && <span className="mom-kpi-prov" title="Cases are entered ~6 days after the date they were written, so this week is still filling.">provisional</span>}
                  </div>
                  <div className="mom-kpi-value">{fmtValue(k)}</div>
                  <div className={`mom-kpi-delta ${d.cls}`}>{d.text}</div>
                  <div className="mom-kpi-vs" title={k.likeForLike ? "Same days of the prior week, so the comparison is like for like." : "Prior complete week."}>
                    vs {k.priorWeekLabel ?? "—"}{k.likeForLike ? " (same days)" : ""}
                  </div>
                  {k.lastFullWeek && (
                    <div
                      className="mom-kpi-current"
                      title="The last week that has fully closed. Kept here because it is the only figure comparable with the 13-week quarter average shown on the chart."
                    >
                      Last full week {k.lastFullWeek.weekLabel} <b>{fmtOne(k, k.lastFullWeek.value)}</b>
                    </div>
                  )}
                  {/* Sat–Mon the new week holds only weekend days, so it does not get the headline —
                      one mortgage and 43 leads read as a 93% collapse and had Kyle reporting the
                      board as broken (2026-08-10). It still gets shown, just at its true size. */}
                  {k.currentWeekSoFar && (
                    <div
                      className="mom-kpi-current"
                      title="The new week has only the weekend so far, which is about 6% of a week's business. The headline stays on the last complete week until Monday's figures are in, so a weekend isn't mistaken for a collapse."
                    >
                      {k.currentWeekSoFar.weekLabel} so far <b>{fmtOne(k, k.currentWeekSoFar.value)}</b>{" "}
                      <span className="mom-kpi-current-sub">weekend only</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {compareFilters && compareData && (
            <CompareStrip
              primaryLabel={filters.from && filters.to ? `${shortDate(filters.from)} – ${shortDate(filters.to)}` : "rolling 13 weeks"}
              compareLabel={`${shortDate(compareFilters.from ?? "")} – ${shortDate(compareFilters.to ?? "")}`}
              rows={data.kpis.map((k) => ({
                label: k.label,
                primary: k.latest,
                compare: compareData.kpis.find((ck) => ck.key === k.key)?.latest ?? null,
                fmt: k.fmt === "int" ? "int" : "gbp",
              }))}
            />
          )}

          {/* SALES ORDER, matching the tiles above one-for-one: leads → written → protection opened
              → £ written → average case size → attach rate. The charts used to run in their own
              order, so the third tile and the third chart were different measures and the eye had
              to re-find each series ("the charts appear to be all over the place and not following"
              — Kyle, 2026-08-18). The first chart is also renamed from "Lead Volume" to match its
              own tile: one measure with two names on one screen is how the old, wider lead count
              got read as the new one. */}
          <div className="row cols-3 grow">
            <Trend title="New Client Leads" metricKey="leads" mode={mode} weeks={data.weeks} values={data.series.leads} vsQ={vsQ(data, "leads")} color={NAVY} estimated={data.partialLastWeek} />
            <Trend title="Mortgages Written" metricKey="applications" mode={mode} weeks={data.weeks} values={data.series.applications} vsQ={vsQ(data, "applications")} color={NAVY} estimated={data.partialLastWeek} />
            <Trend title="Protection Referrals" metricKey="referrals" mode={mode} weeks={data.weeks} values={data.series.referrals} vsQ={vsQ(data, "referrals")} color={BLUE} estimated={data.partialLastWeek} />
            <RevenueTrend
              title="Weekly Written (£k)"
              weeks={data.weeks}
              actual={data.series.writtenActualK}
              forecast={data.series.writtenForecastK}
              vsQ={vsQ(data, "written")}
              written={data.written}
            />
            <Trend title="Avg Case Size (£k) *" metricKey="case-size" mode={mode} weeks={data.weeks} values={data.series.avgCaseSizeK} vsQ={vsQ(data, "case-size")} color={AMBER} />
            <Trend
              title="Protection Attach Rate (%) *" metricKey="attach-rate" mode={mode}
              weeks={data.weeks}
              values={data.series.referralRatePct}
              vsQ={null}
              color={BLUE}
              reference={{ value: data.referralRateTargetPct, label: `${data.referralRateTargetPct}% target` }}
            />
          </div>

          <div className="verdict-bar">
            <span>◆</span>
            <span>{data.verdict}</span>
            {data.partialLastWeek && (
              <span style={{ opacity: 0.65, fontSize: 11 }}>
                · current week shown as a week-to-date estimate (marked "est.") and excluded from deltas
              </span>
            )}
            <span style={{ marginLeft: "auto", opacity: 0.65, fontSize: 11 }}>* Avg Case Size is mortgage value ÷ cases (indicative)</span>
          </div>
        </div>
      )}
    </Load>
  );
}

function vsQ(data: MarketMomentumPayload, key: string): number | null {
  return data.kpis.find((k) => k.key === key)?.vsQuarterPct ?? null;
}

function Trend({ title, weeks, values, vsQ, color, reference, estimated, metricKey, mode }: {
  title: string;
  metricKey?: string;
  mode?: Mode;
  weeks: string[];
  values: Array<number | null>;
  vsQ: number | null;
  color: string;
  reference?: { value: number; label: string };
  /** The last point is a week-to-date extrapolation (current, still-in-progress week). */
  estimated?: boolean;
}) {
  const accel =
    vsQ == null ? null : (
      <span className={`pill ${vsQ > 2 ? "ahead" : vsQ < -2 ? "behind" : "on_pace"}`}>
        {vsQ >= 0 ? "+" : ""}{vsQ}% vs qtr avg
      </span>
    );
  return (
    <div className="card">
      <div className="card-title"><span>{title}{metricKey && mode && <> <MetricInfo metricKey={metricKey} mode={mode} /></>}</span>{accel}</div>
      <div className="grow">
        <EChart
          height={355}
          option={momentumChart({
            weeks,
            values,
            color,
            referenceLine: reference,
            estimatedIndex: estimated ? weeks.length - 1 : undefined,
          })}
        />
      </div>
    </div>
  );
}

/** Weekly Written (Kyle 2026-07-15 "Revenue" = written COMMISSION) — actuals stop at the last
 *  complete week, the current week shows a day-by-day forecast segment.
 *
 *  Written is COMMISSION ONLY. Client fees are stated separately in the footer rather than folded in
 *  (they were, silently, until 2026-07-28) so this figure is on the same basis as Capricorn's own
 *  Total Written report. Protection is now sourced rather than parked at £0, but its basis is still
 *  an open question with Kyle, hence the "indicative" marker. */
function RevenueTrend({ title, weeks, actual, forecast, vsQ, written }: {
  title: string;
  weeks: string[];
  actual: Array<number | null>;
  forecast: Array<number | null>;
  vsQ: number | null;
  written: MarketMomentumPayload["written"];
}) {
  const accel =
    vsQ == null ? null : (
      <span className={`pill ${vsQ > 2 ? "ahead" : vsQ < -2 ? "behind" : "on_pace"}`}>
        {vsQ >= 0 ? "+" : ""}{vsQ}% vs qtr avg
      </span>
    );
  const targetK = Math.round(written.combined.target / 1000);
  const pct = written.combined.target > 0 ? Math.round((written.combined.actual / written.combined.target) * 100) : null;
  const cls = pct == null ? "on_pace" : pct >= 100 ? "ahead" : pct >= 80 ? "on_pace" : "behind";
  return (
    <div className="card">
      <div className="card-title">
        <span>{title}</span>
        {written.provisional && <span className="mom-kpi-prov">provisional</span>}
        {accel}
      </div>
      <div className="grow">
        <EChart height={320} option={momentumForecastChart({ weeks, actual, forecast, referenceLine: { value: targetK, label: `£${targetK}k combined target` } })} />
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "baseline", fontSize: 12, marginTop: 6, opacity: 0.9, flexWrap: "wrap" }}>
        <span><strong>{shortDate(written.weekFrom)} – {shortDate(written.weekTo)}:</strong> {gbpCompact(written.combined.actual)} / {gbpCompact(written.combined.target)}</span>
        {pct != null && <span className={`pill ${cls}`}>{pct}%</span>}
        <span style={{ opacity: 0.7 }}>
          Mortgage {gbpCompact(written.mortgage.actual)} · Protection {gbpCompact(written.insurance.actual)}
        </span>
        <span style={{ marginLeft: "auto", opacity: 0.6 }}>
          commission only — client fees {gbpCompact(written.clientFees)} excluded
        </span>
      </div>
    </div>
  );
}
