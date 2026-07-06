// Screen 5 — Market Momentum: "is the business improving?" — 13-week trends with deltas vs last
// week and the quarter average, plus the verdict bar.

import { usePayload } from "../api.js";
import { AMBER, BLUE, GREEN, momentumChart, NAVY } from "../charts.js";
import { EChart } from "../components/EChart.js";
import { gbpCompact, num } from "../format.js";
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

export function MarketMomentum({ filters, mode, refreshMs }: PageProps) {
  const { data, error } = usePayload<MarketMomentumPayload>("market-momentum", filters, mode, refreshMs);
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

          <div className="row cols-3 grow">
            <Trend title="Mortgage Applications" weeks={data.weeks} values={data.series.applications} vsQ={vsQ(data, "applications")} color={NAVY} />
            <Trend title="Protection Referrals" weeks={data.weeks} values={data.series.referrals} vsQ={vsQ(data, "referrals")} color={BLUE} />
            <Trend title="Weekly Revenue (£k) *" weeks={data.weeks} values={data.series.revenueK} vsQ={vsQ(data, "revenue")} color={GREEN} />
            <Trend title="Lead Volume" weeks={data.weeks} values={data.series.leads} vsQ={vsQ(data, "leads")} color={NAVY} />
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
            {data.partialLastWeek && <span style={{ opacity: 0.65, fontSize: 11 }}>· current week is partial and excluded from deltas</span>}
            <span style={{ marginLeft: "auto", opacity: 0.65, fontSize: 11 }}>* indicative — revenue basis pending confirmation</span>
          </div>
        </div>
      )}
    </Load>
  );
}

function vsQ(data: MarketMomentumPayload, key: string): number | null {
  return data.kpis.find((k) => k.key === key)?.vsQuarterPct ?? null;
}

function Trend({ title, weeks, values, vsQ, color, reference }: {
  title: string;
  weeks: string[];
  values: Array<number | null>;
  vsQ: number | null;
  color: string;
  reference?: { value: number; label: string };
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
        <EChart height={355} option={momentumChart({ weeks, values, color, referenceLine: reference })} />
      </div>
    </div>
  );
}
