// Screen 3 — Adviser League: a week-to-date KPI strip over three cross-ranked leaderboards.
//
// The strip stays on the CURRENT WEEK, matching every other screen, so its figures remain directly
// comparable with the run chase and with Capricorn's own weekly reports. The leaderboards below rank
// over four weeks, because one week ranks on one or two cases — both windows are printed at full
// size rather than left to be inferred. Top Performers / Most Improved / Focus This Month were
// replaced by the boards on 2026-08-13.

import { usePayload } from "../api.js";
import { CompareStrip } from "../components/CompareStrip.js";
import { LeagueBoards } from "../components/LeagueBoards.js";
import { MetricInfo } from "../components/MetricInfo.js";
import { gbpCompact, num, pct, shortDate } from "../format.js";
import type { AdviserLeaguePayload } from "../types.js";
import { Load, type PageProps } from "./common.js";

export function AdviserLeague({ filters, compareFilters, mode, refreshMs }: PageProps) {
  const { data, error } = usePayload<AdviserLeaguePayload>("adviser-league", filters, mode, refreshMs);
  const { data: compareData } = usePayload<AdviserLeaguePayload>("adviser-league", compareFilters ?? null, mode, refreshMs);
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

          <LeagueBoards boards={data.boards} />

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
