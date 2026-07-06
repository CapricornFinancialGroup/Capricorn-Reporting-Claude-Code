// Screen 3 — Adviser League: period KPI strip, Top Performers, Most Improved, Focus This Month.

import { usePayload } from "../api.js";
import { Sparkline } from "../components/ui.js";
import { gbpCompact, num, pct, shortDate } from "../format.js";
import type { AdviserLeaguePayload } from "../types.js";
import { Load, type PageProps } from "./common.js";

const trendArrow = { up: "↑", flat: "→", down: "↓" } as const;
const trendColor = { up: "#16A34A", flat: "#64748B", down: "#DC2626" } as const;

export function AdviserLeague({ filters, mode, refreshMs }: PageProps) {
  const { data, error } = usePayload<AdviserLeaguePayload>("adviser-league", filters, mode, refreshMs);
  const badge = (i: number) => (i === 0 ? "gold" : i === 1 ? "silver" : i === 2 ? "bronze" : "");
  return (
    <Load error={error} data={data}>
      {data && (
        <div className="screen">
          <div className="row" style={{ gridTemplateColumns: "repeat(5, 1fr)" }}>
            {[
              { label: "Total Applications", value: num(data.totals.applications), cls: "val-blue" },
              { label: "Total Referrals", value: num(data.totals.referrals), cls: "" },
              { label: "Total Protection Sales", value: num(data.totals.sales), cls: "val-green" },
              { label: "Est. Revenue *", value: gbpCompact(data.totals.revenue), cls: "" },
              { label: "Avg Conversion *", value: pct(data.totals.avgConversion, 0), cls: "val-blue" },
            ].map((k) => (
              <div className="card mom-kpi" key={k.label}>
                <div className="mom-kpi-label">{k.label}</div>
                <div className={`mom-kpi-value ${k.cls}`}>{k.value}</div>
              </div>
            ))}
          </div>

          <div className="row cols-3 grow">
            <div className="card">
              <div className="card-title">
                <span className="league-panel-title green">Top Performers</span>
                <span className="card-sub">{shortDate(data.window.from)} – {shortDate(data.window.to)} · ranked by applications</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {data.top.map((a, i) => (
                  <div className={`league-row ${i === 0 ? "rank-1" : ""}`} key={a.name}>
                    <span className={`league-badge ${badge(i)}`}>{i + 1}</span>
                    <div>
                      <div className="league-name">{a.name}</div>
                      <div className="league-meta">
                        {a.office !== "Unassigned" ? `${a.office} · ` : ""}avg {a.avgPerDay ?? "—"}/day{" "}
                        <span style={{ color: trendColor[a.trendDir] }}>{trendArrow[a.trendDir]}</span>
                      </div>
                    </div>
                    <div className="league-stats">
                      <span><span className="league-stat-label">Apps</span>{num(a.apps)}</span>
                      <span><span className="league-stat-label">Refs</span>{num(a.refs)}</span>
                      <span><span className="league-stat-label">Sales</span>{num(a.sales)}</span>
                      <Sparkline values={a.trend} color={trendColor[a.trendDir]} width={64} height={20} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="card">
              <div className="card-title">
                <span className="league-panel-title blue">Most Improved</span>
                <span className="card-sub">biggest positive trend vs prior period</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {data.improved.length === 0 && <div className="loading">No qualifying advisers yet this period.</div>}
                {data.improved.map((a) => (
                  <div className="league-row" key={a.name}>
                    <span className="league-badge" style={{ background: "#1D4ED8" }}>↑</span>
                    <div>
                      <div className="league-name">{a.name}</div>
                      <div className="league-meta">prev: {a.lastApps} apps · {a.lastRefs} refs</div>
                    </div>
                    <div className="league-stats">
                      <span><span className="league-stat-label">Apps</span>{num(a.thisApps)}</span>
                      <span><span className="league-stat-label">Refs</span>{num(a.thisRefs)}</span>
                      <span className="val-green">{a.deltaPct != null ? `+${Math.round(a.deltaPct * 100)}%` : "—"}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="card">
              <div className="card-title">
                <span className="league-panel-title amber">Focus This Month</span>
                <span className="card-sub">below target · scheduled for review</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {data.focus.length === 0 && <div className="loading">Nobody needs a nudge — great month.</div>}
                {data.focus.map((a) => (
                  <div className="league-row" key={a.name}>
                    <span className="league-badge" style={{ background: "#D97706" }}>!</span>
                    <div>
                      <div className="league-name">{a.name}</div>
                      <div className="league-meta" style={{ color: trendColor[a.trendDir] }}>
                        {trendArrow[a.trendDir]} {a.note}
                      </div>
                    </div>
                    <div className="league-stats">
                      <span><span className="league-stat-label">Apps</span>{num(a.apps)}</span>
                      <span><span className="league-stat-label">Refs</span>{num(a.refs)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="placeholder-note">
            * Est. revenue = written commission + client fees (indicative — commission basis pending Capricorn confirmation).
            Conversion = referrals ÷ applications.
          </div>
        </div>
      )}
    </Load>
  );
}
