// Screen 5 — Market Momentum: two panels, one question each. LEFT: total written, week by week.
// RIGHT: who wrote it.
//
// Reduced to those two on 2026-08-19 (Luke). The screen previously carried five KPI tiles and six
// trend charts — leads, mortgages written, protection referrals, written £, average case size and
// attach rate — plus a verdict bar. All of it is gone; the payload still carries those series (other
// callers of /api/reporting/market-momentum and the Reconciliation screen read them), they are simply
// no longer drawn here.
//
// ONE MONEY BASIS ON THE PAGE, deliberately. Both panels are written COMMISSION for the SAME week:
// the graph plots the firm total, the league splits that total across the ten advisers who earned the
// most of it, and the total is printed under the league so the two can be checked against each other
// by eye. The mortgage/protection split has been removed from the graph's footer for the same reason —
// this screen no longer shows any figure that can be mistaken for a different figure on it.
//
// The league is labelled "mortgages" but counts ALL commission: mortgage, protection and general
// insurance together, never split ("that can be either protection, mortgages, or general insurance.
// It doesn't actually matter which" — 2026-08-19).

import { usePayload } from "../api.js";
import { momentumForecastChart } from "../charts.js";
import { EChart } from "../components/EChart.js";
import { MetricInfo } from "../components/MetricInfo.js";
import { gbpCompact, num, shortDate } from "../format.js";
import type { MarketMomentumPayload } from "../types.js";
import type { Mode } from "../api.js";
import { Load, type PageProps } from "./common.js";

/** Input lag: cases reach the platform ~6 days after they were written, so a just-closed week is
 *  still filling. Both panels carry the same chip because they are the same week's money. */
const PROVISIONAL_TITLE =
  "Cases are entered on the platform about 6 days after the date they were written, so this week is still filling and its figures will rise.";

export function MarketMomentum({ filters, mode, refreshMs }: PageProps) {
  const { data, error } = usePayload<MarketMomentumPayload>("market-momentum", filters, mode, refreshMs);
  return (
    <Load error={error} data={data}>
      {data && (
        <div className="screen">
          <div className="row cols-2 grow">
            <TotalWritten data={data} mode={mode} />
            <CommissionLeague data={data} mode={mode} />
          </div>
        </div>
      )}
    </Load>
  );
}

/** Total written — weekly written COMMISSION, week by week. Named after Capricorn's own report
 *  (usp_GetTotalProductReport, the "Total Written Report") because it is on that report's basis; a
 *  figure that reconciles to a report should carry the report's name, not a second one.
 *
 *  Actuals stop at the last complete week; the current, part week is a dashed day-by-day forecast
 *  rather than an extrapolated point pretending to be real.
 *
 *  Written is commission ONLY. Client fees are stated in the footer rather than folded in (they were,
 *  silently, until 2026-07-28) so this is on the same basis as Capricorn's own Total Written report. */
function TotalWritten({ data, mode }: { data: MarketMomentumPayload; mode: Mode }) {
  const { written } = data;
  const vsQ = data.kpis.find((k) => k.key === "written")?.vsQuarterPct ?? null;
  const targetK = Math.round(written.combined.target / 1000);
  const pct = written.combined.target > 0 ? Math.round((written.combined.actual / written.combined.target) * 100) : null;
  const cls = pct == null ? "on_pace" : pct >= 100 ? "ahead" : pct >= 80 ? "on_pace" : "behind";
  return (
    <div className="card">
      <div className="card-title">
        <span>
          Total Written (£k) <MetricInfo metricKey="written" mode={mode} />
        </span>
        {written.provisional && (
          <span className="mom-kpi-prov" title={PROVISIONAL_TITLE}>
            provisional
          </span>
        )}
        {vsQ != null && (
          <span className={`pill ${vsQ > 2 ? "ahead" : vsQ < -2 ? "behind" : "on_pace"}`}>
            {vsQ >= 0 ? "+" : ""}
            {vsQ}% vs qtr avg
          </span>
        )}
      </div>
      {/* A flex COLUMN, so the chart can grow past its preferred height. `.grow` is a plain block by
          default and a block child cannot flex — which left the chart drawing at 560px and the bottom
          third of a 1080 wall card empty. Column, not row: in a row the chart's height would be the
          cross axis, where an explicit height beats `stretch` and nothing grows. */}
      <div className="grow" style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
        {/* A PREFERRED height, flexed down inside the card (see EChart). It is set generously because
            this screen is now two panels rather than eight: on the dashboard, where `.dash-main` is
            not a flex column, the page is only as tall as its content, so the chart's own height is
            what stops two half-width cards floating in a sea of white. On the wall the kiosk canvas
            is a fixed 1080 flex column and both panels stretch to fill it regardless. */}
        <EChart
          height={560}
          option={momentumForecastChart({
            weeks: data.weeks,
            actual: data.series.writtenActualK,
            forecast: data.series.writtenForecastK,
            referenceLine: { value: targetK, label: `£${targetK}k combined target` },
          })}
        />
      </div>
      <div className="mcl-total">
        <span>
          <strong>
            {written.weekLabel} · {shortDate(written.weekFrom)} – {shortDate(written.weekTo)}:
          </strong>{" "}
          {gbpCompact(written.combined.actual)} / {gbpCompact(written.combined.target)}
        </span>
        {pct != null && <span className={`pill ${cls}`}>{pct}%</span>}
        <span style={{ marginLeft: "auto", opacity: 0.65, fontSize: 10.5 }}>
          all written commission · client fees {gbpCompact(written.clientFees)} excluded
        </span>
      </div>
    </div>
  );
}

/** Top 10 commission earners for the same week the graph reports.
 *
 *  The total beneath is the graph's own figure for that week, so the rows and the chart beside them
 *  are checkable against each other without leaving the screen — that is the reason the total is
 *  printed at all.
 *
 *  Caveat that cannot be fixed here: per-adviser protection commission does not match the platform's
 *  Total Written Report while commission SPLITS are missing from the data share — a split case credits
 *  its primary adviser in full here and is divided across two names there. Firm totals, i.e. the graph
 *  and the total below, are unaffected. See SPLIT_RECIPIENT_SOURCE in src/domain/data-quality.ts. */
function CommissionLeague({ data, mode }: { data: MarketMomentumPayload; mode: Mode }) {
  const { league } = data;
  const share = league.total > 0 ? Math.round((sumRows(league.rows) / league.total) * 100) : null;
  return (
    <div className="card">
      <div className="card-title">
        <span>
          Mortgages — Top 10 Commission Earners <MetricInfo metricKey="commission-league" mode={mode} />
        </span>
        {league.provisional && (
          <span className="mom-kpi-prov" title={PROVISIONAL_TITLE}>
            provisional
          </span>
        )}
        <span className="card-sub">
          {league.weekLabel} · {shortDate(league.weekFrom)} – {shortDate(league.weekTo)}
        </span>
      </div>
      {league.rows.length === 0 ? (
        <div className="mcl-empty">No commission recorded in {league.weekLabel}.</div>
      ) : (
        <div className="mcl-rows">
          {league.rows.map((r) => (
            <div className={`mcl-row${r.rank === 1 ? " mcl-first" : ""}`} key={r.name}>
              <span className="mcl-rank">{r.rank}</span>
              <span className="mcl-who">
                <span className="mcl-name">{r.name}</span>
                <span className="mcl-cases">
                  {num(r.cases)} case{r.cases === 1 ? "" : "s"} written
                </span>
              </span>
              <span className="mcl-value">{gbpCompact(r.commission)}</span>
            </div>
          ))}
        </div>
      )}
      <div className="mcl-total">
        <span>
          <strong>{league.weekLabel} total {gbpCompact(league.total)}</strong> — the figure on the graph
        </span>
        {share != null && <span className="pill muted">top 10 = {share}%</span>}
        <span style={{ marginLeft: "auto", opacity: 0.65, fontSize: 10.5 }}>
          top 10 of {num(league.earners)} earning advisers
          {league.unattributed > 0 && <> · {gbpCompact(league.unattributed)} on cases with no adviser on file</>}
        </span>
      </div>
      <div className="lb-foot">
        All written commission for the week, whichever product line earned it — mortgage, protection and general
        insurance are counted together and not split. Commission is what the lender or provider pays Capricorn;
        client fees are not included. A commission SPLIT credits the case's primary adviser in full here, because the
        recipient of a split is not yet in the data share — so an individual row can differ from the platform's
        Total Written Report even though the week's total does not.
      </div>
    </div>
  );
}

function sumRows(rows: MarketMomentumPayload["league"]["rows"]): number {
  return rows.reduce((a, r) => a + r.commission, 0);
}
