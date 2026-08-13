// Screen 3 — Adviser League: period KPI strip, Top Performers, Most Improved, Focus This Month.

import { usePayload } from "../api.js";
import { CompareStrip } from "../components/CompareStrip.js";
import { Sparkline } from "../components/ui.js";
import { MetricInfo } from "../components/MetricInfo.js";
import { gbpCompact, num, pct, shortDate } from "../format.js";
import type { AdviserLeaguePayload } from "../types.js";
import { Load, type PageProps } from "./common.js";

const trendArrow = { up: "↑", flat: "→", down: "↓" } as const;
const trendColor = { up: "#16A34A", flat: "#64748B", down: "#DC2626" } as const;

/**
 * Column headings for the per-adviser rows.
 *
 * These said "Apps" and "Refs" until 2026-08-11 — the two words that were deliberately RETIRED from
 * the tiles above them, for being wrong:
 *
 *   "Applications" → "Mortgages Written"        (2026-07-28) it counts business written, not
 *                                                applications submitted to a lender
 *   "Referrals"    → "Protection Opportunities" (2026-07-30) the tile was counting PaymentShield
 *                                                quote attempts; Capricorn records no referral event
 *
 * The rename never reached the league rows, so the same screen showed "Protection Opportunities" in
 * its headline and "Refs" underneath — for the identical number. That is the "no consistency across
 * the screens" complaint reproduced inside a single card. The short forms below are abbreviations OF
 * the agreed names rather than survivals of the old ones, and each carries the full name on hover.
 */
const COLS = {
  apps: { short: "Written", full: "Mortgages Written — business formally submitted for processing, not applications sent to a lender" },
  refs: { short: "Opps", full: "Protection Opportunities — protection cases opened. NOT a count of referrals" },
  sales: { short: "Sales", full: "Protection Sales — protection cases that have reached submission or beyond" },
} as const;

export function AdviserLeague({ filters, compareFilters, mode, refreshMs }: PageProps) {
  const { data, error } = usePayload<AdviserLeaguePayload>("adviser-league", filters, mode, refreshMs);
  const { data: compareData } = usePayload<AdviserLeaguePayload>("adviser-league", compareFilters ?? null, mode, refreshMs);
  const badge = (i: number) => (i === 0 ? "gold" : i === 1 ? "silver" : i === 2 ? "bronze" : "");
  return (
    <Load error={error} data={data}>
      {data && (
        <div className="screen">
          {/* Every dial states its window. These are week-to-date (usually 1–3 trading days), while
              Market Momentum's tiles report the last COMPLETE week — reading one as the other is how
              £24.2k here got compared with £266.3k there (Kyle 2026-07-28). */}
          <div className="row" style={{ gridTemplateColumns: "repeat(5, 1fr)" }}>
            {[
              { label: "Mortgages Written", value: num(data.totals.applications), cls: "val-blue", sub: null, mk: "applications" },
              { label: "Protection Opportunities", value: num(data.totals.referrals), cls: "", sub: null, mk: "referrals" },
              { label: "Total Protection Sales", value: num(data.totals.sales), cls: "val-green", sub: null, mk: "sales" },
              {
                // Commission ONLY. Client fees are stated beneath as a separate figure, never added
                // in — Capricorn's Total Written Report is a commission report and does not capture
                // the client fee (Kyle, 2026-08-10), so folding it in guaranteed a gap on every
                // comparison he made.
                label: "Written Commission",
                value: gbpCompact(data.totals.revenue),
                cls: "",
                sub: `mortgage ${gbpCompact(data.totals.mortgageWritten)} + protection ${gbpCompact(data.totals.protectionWritten)} · client fees ${gbpCompact(data.totals.clientFees)} shown separately, NOT included`,
                mk: "revenue",
              },
              { label: "Avg Conversion *", value: pct(data.totals.avgConversion, 0), cls: "val-blue", sub: null, mk: "attach-rate" },
            ].map((k) => (
              <div className="card mom-kpi" key={k.label}>
                <div className="mom-kpi-label">{k.label} <MetricInfo metricKey={k.mk} mode={mode} /></div>
                <div className="mom-kpi-window">{shortDate(data.window.from)} – {shortDate(data.window.to)}</div>
                <div className={`mom-kpi-value ${k.cls}`}>{k.value}</div>
                {k.sub && <div className="mom-kpi-vs">{k.sub}</div>}
              </div>
            ))}
          </div>

          {compareFilters && compareData && (
            <CompareStrip
              primaryLabel={`${shortDate(data.window.from)} – ${shortDate(data.window.to)}`}
              compareLabel={`${shortDate(compareData.window.from)} – ${shortDate(compareData.window.to)}`}
              rows={[
                { label: "Mortgages Written", primary: data.totals.applications, compare: compareData.totals.applications, fmt: "int" },
                { label: "Protection Opportunities", primary: data.totals.referrals, compare: compareData.totals.referrals, fmt: "int" },
                { label: "Protection Sales", primary: data.totals.sales, compare: compareData.totals.sales, fmt: "int" },
                { label: "Written Commission", primary: data.totals.revenue, compare: compareData.totals.revenue, fmt: "gbp" },
                { label: "Avg Conversion", primary: data.totals.avgConversion, compare: compareData.totals.avgConversion, fmt: "pct" },
              ]}
            />
          )}

          <div className="row cols-3 grow">
            <div className="card">
              <div className="card-title">
                <span className="league-panel-title green">Top Performers</span>
                <span className="card-sub">{shortDate(data.window.from)} – {shortDate(data.window.to)} · ranked by mortgages written</span>
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
                      <span title={COLS.apps.full}><span className="league-stat-label">{COLS.apps.short}</span>{num(a.apps)}</span>
                      <span title={COLS.refs.full}><span className="league-stat-label">{COLS.refs.short}</span>{num(a.refs)}</span>
                      <span title={COLS.sales.full}><span className="league-stat-label">{COLS.sales.short}</span>{num(a.sales)}</span>
                      <Sparkline values={a.trend} color={trendColor[a.trendDir]} width={64} height={20} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="card">
              <div className="card-title">
                <span className="league-panel-title blue">Most Improved</span>
                <span className="card-sub">biggest positive trend vs prior period · current week pace-adjusted</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {data.improved.length === 0 && <div className="loading">No qualifying advisers yet this period.</div>}
                {data.improved.map((a) => (
                  <div className="league-row" key={a.name}>
                    <span className="league-badge" style={{ background: "#1D4ED8" }}>↑</span>
                    <div>
                      <div className="league-name">{a.name}</div>
                      <div className="league-meta">prev: {a.lastApps} written · {a.lastRefs} opps</div>
                    </div>
                    <div className="league-stats">
                      <span title={COLS.apps.full}><span className="league-stat-label">{COLS.apps.short}</span>{num(a.thisApps)}</span>
                      <span title={COLS.refs.full}><span className="league-stat-label">{COLS.refs.short}</span>{num(a.thisRefs)}</span>
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
                      <span title={COLS.apps.full}><span className="league-stat-label">{COLS.apps.short}</span>{num(a.apps)}</span>
                      <span title={COLS.refs.full}><span className="league-stat-label">{COLS.refs.short}</span>{num(a.refs)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="placeholder-note">
            * Written commission, for the dates shown above, is <em>mortgage commission</em> (the procuration fee
            the lender pays) + <em>protection commission</em> — the same pair as Capricorn's Total Written Report,
            so it compares directly. <strong>Client fees are not included.</strong> The client fee is the
            advice/arrangement fee the adviser enters on the case (not solicitor or miscellaneous fees, which are
            recorded separately); it is shown beside the total because it is real income, but Capricorn's written
            report does not capture it, so adding it in would put this permanently above their figure.
            Conversion = protection opportunities ÷ mortgages written.
          </div>
        </div>
      )}
    </Load>
  );
}
