// Screen 5 — Market Momentum: "is the business improving?" — 13-week trends with deltas vs last
// week and the quarter average, plus the verdict bar.

import { usePayload } from "../api.js";
import { AMBER, BLUE, momentumChart, momentumForecastChart, NAVY } from "../charts.js";
import { CompareStrip } from "../components/CompareStrip.js";
import { EChart } from "../components/EChart.js";
import { gbpCompact, num, shortDate } from "../format.js";
import type { MarketMomentumPayload, MomentumKpi } from "../types.js";
import { Load, type PageProps } from "./common.js";

function fmtValue(k: MomentumKpi): string {
  if (k.latest == null) return "—";
  if (k.fmt === "gbpk") return gbpCompact(k.latest);
  if (k.fmt === "gbp") return gbpCompact(k.latest);
  return num(Math.round(k.latest));
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
                  <div className="mom-kpi-label">{k.label}</div>
                  <div className="mom-kpi-value">{fmtValue(k)}</div>
                  <div className={`mom-kpi-delta ${d.cls}`}>{d.text}</div>
                  <div className="mom-kpi-vs">{k.weekLabel} vs prior week</div>
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

          <div className="row cols-3 grow">
            <Trend title="Mortgage Applications" weeks={data.weeks} values={data.series.applications} vsQ={vsQ(data, "applications")} color={NAVY} estimated={data.partialLastWeek} />
            <Trend title="Protection Referrals" weeks={data.weeks} values={data.series.referrals} vsQ={vsQ(data, "referrals")} color={BLUE} estimated={data.partialLastWeek} />
            <RevenueTrend
              title="Weekly Written (£k)"
              weeks={data.weeks}
              actual={data.series.writtenActualK}
              forecast={data.series.writtenForecastK}
              vsQ={vsQ(data, "written")}
              reference={{ value: data.writtenTargetCombinedK, label: `£${data.writtenTargetCombinedK}k target` }}
              written={data.written}
            />
            <Trend title="Lead Volume" weeks={data.weeks} values={data.series.leads} vsQ={vsQ(data, "leads")} color={NAVY} estimated={data.partialLastWeek} />
            <Trend title="Avg Case Size (£k) *" weeks={data.weeks} values={data.series.avgCaseSizeK} vsQ={vsQ(data, "case-size")} color={AMBER} />
            <Trend
              title="Protection Referral Rate (%) *"
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

function Trend({ title, weeks, values, vsQ, color, reference, estimated }: {
  title: string;
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
      <div className="card-title"><span>{title}</span>{accel}</div>
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

/** Weekly Written (item 12, reframed; Kyle 2026-07-14 "Revenue" = written business) — actuals stop
 *  at the last complete week, the current week shows a day-by-day forecast segment, a reference line
 *  marks the combined weekly target, and a footer breaks out Mortgage / Insurance vs their targets. */
function RevenueTrend({ title, weeks, actual, forecast, vsQ, reference, written }: {
  title: string;
  weeks: string[];
  actual: Array<number | null>;
  forecast: Array<number | null>;
  vsQ: number | null;
  reference?: { value: number; label: string };
  written: MarketMomentumPayload["written"];
}) {
  const accel =
    vsQ == null ? null : (
      <span className={`pill ${vsQ > 2 ? "ahead" : vsQ < -2 ? "behind" : "on_pace"}`}>
        {vsQ >= 0 ? "+" : ""}{vsQ}% vs qtr avg
      </span>
    );
  return (
    <div className="card">
      <div className="card-title"><span>{title}</span>{accel}</div>
      <div className="grow">
        <EChart height={300} option={momentumForecastChart({ weeks, actual, forecast, referenceLine: reference })} />
      </div>
      <div style={{ display: "flex", gap: 16, fontSize: 12, marginTop: 6, opacity: 0.9 }}>
        <WrittenVsTarget label="Mortgage" row={written.mortgage} />
        <WrittenVsTarget label="Insurance" row={written.insurance} />
      </div>
    </div>
  );
}

/** One product's written-vs-target for the latest complete week (£), with a pace pill. */
function WrittenVsTarget({ label, row }: { label: string; row: { actual: number; target: number } }) {
  const pct = row.target > 0 ? Math.round((row.actual / row.target) * 100) : null;
  const cls = pct == null ? "on_pace" : pct >= 100 ? "ahead" : pct >= 80 ? "on_pace" : "behind";
  return (
    <span style={{ display: "inline-flex", alignItems: "baseline", gap: 6 }}>
      <strong>{label}:</strong> {gbpCompact(row.actual)} / {gbpCompact(row.target)}
      {pct != null && <span className={`pill ${cls}`}>{pct}%</span>}
    </span>
  );
}
