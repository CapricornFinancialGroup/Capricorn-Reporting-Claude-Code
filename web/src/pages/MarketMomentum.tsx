// Screen 5 — Market Momentum: two panels, one question each. LEFT: total written, week by week.
// RIGHT: who wrote it.
//
// Reduced to those two on 2026-08-19 (Luke). The screen previously carried five KPI tiles and six
// trend charts — leads, mortgages written, protection referrals, written £, average case size and
// attach rate — plus a verdict bar. All of it is gone; the payload still carries those series (other
// callers of /api/reporting/market-momentum and the Reconciliation screen read them), they are simply
// no longer drawn here.
//
// THE CURRENT WEEK, TO DATE — changed 2026-08-20. Both panels reported the last COMPLETE week, which
// read as the page being a week behind the rest of the board: "it looks like the market momentum page
// is basing off week 33 rather than the current week of 34" (Capricorn). The KPI tiles moved to the
// current week on 2026-08-07 at Kyle's request and these two panels never followed them.
//
// What moved with the subject are the COMPARISONS, because a part week cannot be judged the way a
// whole one can: the week to date is set against the prior week's SAME days, the target percentage is
// set against the forecast full week rather than against the part-week actual, and the last ended week
// stays on screen as the figure a Total Written Report can be run against. See `subjectIdx` in
// datasets.ts for the weekend guard that holds the current week back until Monday is loaded.
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

/**
 * Both panels carry the same chip because they are the same week's money.
 *
 * KEPT, AND NOW SAYS WHAT IT MEANS. Capricorn asked on 2026-08-20 to drop it "unless you can tell me
 * why we need to have provision on there". The week snapshots (services/snapshots, recording since
 * 10 Aug) answer that: every closed week observed has moved after it closed, and two of the three
 * moved DOWN, which is business leaving a week rather than late entry arriving.
 *
 *   25–31 Jul   mortgage commission £413,540 → £414,283, still climbing on 19 Aug (day 19, i.e.
 *               AFTER the 14-day settle window), protection cases 28 → 29
 *   1–7 Aug     mortgage cases 167 → 166, protection commission £21,651 → £20,065 (−7.3%),
 *               client fees −£301 — every one of them DOWN
 *   8–14 Aug    mortgage commission −£220, client fees −£200
 *
 * So the chip is load-bearing: a figure quoted from a just-closed week can be wrong by several
 * thousand pounds within a fortnight. The old wording claimed figures "will rise", which the same
 * evidence contradicts — the movement goes both ways, and saying otherwise would have made a
 * downward revision look like a bug.
 */
const PROVISIONAL_TITLE =
  "Not final, for two reasons. The week is still running, so this is business written so far. And " +
  "business written is entered on the platform days later while cases already counted are sometimes " +
  "removed, so even after the week closes the figures move in EITHER direction — every closed week " +
  "tracked so far has moved, by up to 7%. The Reconciliation screen holds each week's history.";

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
  // THE TARGET PERCENTAGE HANGS OFF THE FORECAST WHILE THE WEEK IS RUNNING, not off the week-to-date
  // actual. A whole-week target can only fairly judge a whole-week figure: £160k of a £436k target
  // through Wednesday is 37%, which reads as a collapse and is simply the wrong comparison. Input lag
  // makes it worse than pro-rating would suggest — Wednesday's written commission is still arriving
  // the following Monday — so the forecast, which is built from recent actual daily rates, is the
  // honest full-week number. Once the week finishes, actual IS the full-week figure and is used.
  const judged = written.partial ? written.forecast : written.combined.actual;
  const pct = written.combined.target > 0 && judged != null
    ? Math.round((judged / written.combined.target) * 100)
    : null;
  const cls = pct == null ? "on_pace" : pct >= 100 ? "ahead" : pct >= 80 ? "on_pace" : "behind";
  // Like-for-like against the prior week's same days — the comparison Kyle asked for (2026-08-07) and
  // the only one that is fair on a part week.
  const lfl = written.priorSameDay != null && written.priorSameDay > 0
    ? Math.round(((written.combined.actual - written.priorSameDay) / written.priorSameDay) * 100)
    : null;
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
      {/* `.chart-box`, not `.grow`: a chart must be able to grow PAST its preferred height, and `.grow`
          is a plain block, whose child cannot flex — which left this chart at 560px with the bottom
          third of a 1080 wall card empty. `.chart-box` is the flex column for exactly this, added on
          main in 1ca6dd0 for the same bug seen elsewhere; it is deliberately not a modifier on `.grow`,
          which is also applied to grid rows where `display: flex` would break the columns. */}
      <div className="chart-box">
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
      {/* Every figure here is comparable with something real, and says which. The week to date is
          compared with the same days of the week before; the target percentage is compared with the
          forecast full week; and the last ENDED week is kept on screen because it is the only figure
          on this page a Total Written Report can be run against. */}
      <div className="mcl-total">
        <span>
          <strong>
            {written.weekLabel}
            {written.partial ? ` to ${shortDate(written.throughDay)}` : ` · ${shortDate(written.weekFrom)} – ${shortDate(written.weekTo)}`}:
          </strong>{" "}
          {gbpCompact(written.combined.actual)}
          {lfl != null && written.priorWeekLabel && (
            <>
              {" "}
              <span className={lfl >= 0 ? "val-green" : "val-amber"}>
                {lfl >= 0 ? "+" : "−"}{Math.abs(lfl)}%
              </span>{" "}
              <span style={{ opacity: 0.7 }}>vs {written.priorWeekLabel} same days</span>
            </>
          )}
        </span>
        {written.partial && written.forecast != null && (
          <span style={{ opacity: 0.8 }}>
            forecast {gbpCompact(written.forecast)} / {gbpCompact(written.combined.target)}
          </span>
        )}
        {!written.partial && <span style={{ opacity: 0.8 }}>of {gbpCompact(written.combined.target)}</span>}
        {pct != null && <span className={`pill ${cls}`}>{pct}%</span>}
        <span style={{ marginLeft: "auto", opacity: 0.65, fontSize: 10.5 }}>
          {written.lastComplete && (
            <>
              last full week {written.lastComplete.weekLabel} {gbpCompact(written.lastComplete.actual)} ·{" "}
            </>
          )}
          commission only · client fees {gbpCompact(written.clientFees)} excluded
        </span>
      </div>
    </div>
  );
}

/** Top 10 commission earners over the same window the graph's headline reports — the CURRENT week to
 *  date, so this is who is earning it now rather than who earned it last week.
 *
 *  The total beneath is the graph's own figure for that window, so the rows and the chart beside them
 *  are checkable against each other without leaving the screen — that is the reason the total is
 *  printed at all.
 *
 *  A part-week ranking moves around, and that is the point of a momentum screen; the ordering firms up
 *  as the week fills. What it must not do is imply completeness, hence "so far" in the subtitle and the
 *  provisional chip.
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
          {league.partial
            ? `${league.weekLabel} so far · ${shortDate(league.weekFrom)} – ${shortDate(league.throughDay)}`
            : `${league.weekLabel} · ${shortDate(league.weekFrom)} – ${shortDate(league.weekTo)}`}
        </span>
      </div>
      {/* The empty state is reachable early in a week now that the subject is the current one, so it
          must not read as "nobody earned anything this week" when it means "not yet". */}
      {league.rows.length === 0 ? (
        <div className="mcl-empty">
          No commission recorded in {league.weekLabel}
          {league.partial ? ` yet — up to ${shortDate(league.throughDay)}` : ""}.
        </div>
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
      {/* "the figure on the graph" was true while both halves reported a finished week — the graph's
          last ACTUAL point and this total were the same number. On a part week they are not: the graph
          plots a dashed FORECAST at the current week, so the week-to-date total these rows add up to
          appears nowhere on it. It now points at the figure it actually equals, which is the headline
          under the graph — still checkable by eye, without claiming a match that isn't there. */}
      <div className="mcl-total">
        <span>
          <strong>
            {league.weekLabel} {league.partial ? "so far" : "total"} {gbpCompact(league.total)}
          </strong>{" "}
          — {league.partial ? "the headline under the graph" : "the figure on the graph"}
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
