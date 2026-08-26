// ECharts option builders for the Growth OS chart vocabulary. Kept declarative so pages just
// supply data + colours. Colour language matches the strawman screens: dashed grey target pace,
// navy actual (amber when behind), dotted grey projection, NOW marker at the data-as-of day.
//
// `animation: false` on every builder is load-bearing, not cosmetic: EChart.tsx calls
// setOption(option, true) on every render, including the ~60s data poll, so ECharts' default
// entrance animation (lines sweeping in, axis labels rescaling as the auto `scale:true` range
// keeps changing mid-draw) was replaying every refresh — the wall/kiosk "text flies across and
// up and down" report (Conor/Luke, 2026-07-07). A wall display should show correct data
// immediately, not redraw itself on a loop.

import type { EChartsOption } from "echarts";
import { weekdayShort } from "./format.js";

const AXIS_TEXT = "#64748B";
export const NAVY = "#0E2040";
export const PACE_GREY = "#CBD5E1";
export const PROJECTION_GREY = "#94A3B8";
export const GREEN = "#16A34A";
export const AMBER = "#D97706";
export const RED = "#DC2626";
export const BLUE = "#1D4ED8";

export const STATUS_COLOR: Record<string, string> = {
  ahead: GREEN,
  on_pace: BLUE,
  behind: AMBER,
  critical: RED,
};

/** For a figure that is real but carries no verdict — a target too small to band honestly. Grey on
 *  purpose: green, amber and red all make a claim, and the point is that there isn't one to make. */
export const NO_VERDICT_GREY = PROJECTION_GREY;

/**
 * Run-chase pace chart (strawman screen 1): straight dashed target-pace line, actual line with
 * area fill (navy when ahead/on-pace, amber when behind), dotted projection from "now" to the
 * projected finish, and a NOW marker on the data-as-of day.
 */
export function paceChart(opts: {
  days: string[];
  actual: Array<number | null>;
  /** Null for an UNTARGETED KPI — no target line is drawn. A flat zero pace line would read as the
   *  team beating a target of nothing, which is exactly the false verdict `targeted` exists to stop. */
  targetPace: number[] | null;
  projection: Array<number | null> | null;
  /**
   * TODAY, STILL FILLING. A two-point series — the last complete day's cumulative, then that plus
   * what today has recorded so far — drawn dotted in the hero colour so the chase reaches the day it
   * is actually on. Capricorn, 2026-08-21: "we should be reflecting the progress throughout the day …
   * maybe use the through the day as a dotted line."
   *
   * DOTTED IS LOAD-BEARING, not decoration. At the morning load the ETL holds ~1.5% of the day
   * (dayRecordedShare), so a solid continuation would show the line flattening against a climbing
   * pace line every morning — the 2026-07-30 false collapse, redrawn. Dotted, and stopping short of
   * the pace line, reads as "not in yet" rather than "not done".
   */
  today: Array<number | null> | null;
  /**
   * What today's column MEANS, for the tooltip. Without it the tooltip listed four raw series and
   * the reader had to reconcile them: "Target pace 169 · Actual – · Projection 153 · Today so far
   * 106". Three of those four were actively misleading — the dash reads as "nothing has been done",
   * "Today so far 106" was the cumulative week (44 + 62) contradicting the 62 on the tile below it,
   * and 106 against a full-Monday 169 makes every morning look like a collapse.
   *
   * Capricorn, 2026-08-24: "they look at it and think nothing's been done and start questioning the
   * data. It takes away from the focus." A growth board cannot afford a tooltip that argues with the
   * card it sits on.
   */
  todayInfo?: {
    /** Index of today in `days`. */
    idx: number;
    /** Today's OWN count, not the cumulative — the figure the tile shows. */
    count: number;
    /** Cumulative expected by now: whole complete days + the recorded share of today. */
    expectedCum: number;
    /** Cumulative achieved − expectedCum. Positive = ahead. */
    aheadBehind: number;
    /** Whole-percent share of today the data share holds at this load. */
    sharePct: number;
  } | null;
  behind: boolean;
  nowLabel?: string;
}): EChartsOption {
  const hero = opts.behind ? AMBER : NAVY;
  const heroFill = opts.behind ? "rgba(217,119,6,0.06)" : "rgba(14,32,64,0.06)";
  let nowIdx = -1;
  for (let i = 0; i < opts.actual.length; i++) if (opts.actual[i] != null) nowIdx = i;
  return {
    animation: false,
    grid: { left: 44, right: 14, top: 22, bottom: 26, containLabel: true },
    // ONE reality row, never a dash, and today judged against what is actually in.
    //
    // Built by hand rather than left to the default series list because the four series do not carry
    // equal weight for a reader: "how are we doing" is one line (achieved), against one benchmark
    // (what should be in by now). Target-for-the-whole-day and projection are context, and go last.
    tooltip: {
      trigger: "axis",
      formatter: (raw: unknown): string => {
        const params = (Array.isArray(raw) ? raw : [raw]) as Array<{ axisValue?: string; dataIndex?: number }>;
        const i = params[0]?.dataIndex ?? -1;
        const label = params[0]?.axisValue ?? "";
        if (i < 0) return "";
        const n = (v: number) => Math.round(v).toLocaleString();
        const isToday = opts.todayInfo != null && opts.todayInfo.idx === i;
        // The reality figure: today's dotted cumulative if this is today, else the solid actual.
        const achieved = isToday ? opts.today?.[i] : opts.actual[i];
        const fullDay = opts.targetPace?.[i];
        const rows: string[] = [];
        const row = (k: string, v: string, cls = "") =>
          rows.push(`<div class="ct-row${cls ? ` ${cls}` : ""}"><span>${k}</span><b>${v}</b></div>`);

        if (isToday && opts.todayInfo) {
          const { count, expectedCum, aheadBehind, sharePct } = opts.todayInfo;
          if (achieved != null) row("Achieved", n(achieved));
          row("of which today", n(count), "ct-sub");
          row("Expected by now", n(expectedCum));
          const dir = aheadBehind >= 0 ? "ct-ahead" : "ct-behind";
          const arrow = aheadBehind >= 0 ? "▲" : "▼";
          row("", `<span class="${dir}">${arrow} ${n(Math.abs(aheadBehind))} ${aheadBehind >= 0 ? "ahead" : "behind"}</span>`, "ct-verdict");
          if (fullDay != null) row("Full day target", n(fullDay), "ct-ctx");
          return `<div class="ct"><div class="ct-head">${label} · part day, ${sharePct}% in</div>${rows.join("")}</div>`;
        }

        // A COMPLETE day, or a day still ahead of us. Either way: no dashes — a row with nothing
        // behind it is omitted, not printed as "–".
        if (achieved != null) row("Achieved", n(achieved));
        if (fullDay != null) row(achieved != null ? "Target by now" : "Target pace", n(fullDay));
        if (achieved != null && fullDay != null) {
          const gap = achieved - fullDay;
          const dir = gap >= 0 ? "ct-ahead" : "ct-behind";
          const arrow = gap >= 0 ? "▲" : "▼";
          row("", `<span class="${dir}">${arrow} ${n(Math.abs(gap))} ${gap >= 0 ? "ahead" : "behind"}</span>`, "ct-verdict");
        }
        const proj = opts.projection?.[i];
        if (achieved == null && proj != null) row("Projection", n(proj), "ct-ctx");
        if (!rows.length) return "";
        return `<div class="ct"><div class="ct-head">${label}</div>${rows.join("")}</div>`;
      },
    },
    xAxis: {
      type: "category",
      boundaryGap: false,
      data: opts.days.map(weekdayShort),
      // Weekday, not date: the chase week became SEVEN days on 2026-08-04 and seven "1 Aug"-style
      // labels collide in a quarter-width card. The card header already names the week.
      axisLabel: { color: AXIS_TEXT, fontSize: 9, interval: 0, hideOverlap: true },
      axisLine: { lineStyle: { color: "rgba(0,0,0,0.1)" } },
    },
    yAxis: {
      type: "value",
      min: 0,
      axisLabel: { color: AXIS_TEXT, fontSize: 9 },
      splitLine: { lineStyle: { color: "rgba(0,0,0,0.06)" } },
    },
    series: [
      // Target and projection are dropped entirely for an untargeted KPI rather than drawn as zero.
      ...(opts.targetPace
        ? [{
            name: "Target pace",
            type: "line" as const,
            data: opts.targetPace,
            showSymbol: false,
            lineStyle: { width: 1.5, type: "dashed" as const, color: PACE_GREY },
            z: 1,
          }]
        : []),
      {
        name: "Actual",
        type: "line",
        data: opts.actual,
        smooth: 0.3,
        showSymbol: false,
        connectNulls: false,
        lineStyle: { width: 2.5, color: hero },
        itemStyle: { color: hero },
        areaStyle: { color: heroFill },
        z: 3,
        markLine:
          nowIdx >= 0
            ? {
                symbol: "none",
                silent: true,
                lineStyle: { color: "rgba(100,116,139,0.35)", type: "dashed", width: 1 },
                // "NOW" until 2026-08-21, when the dotted today segment started being drawn PAST this
                // marker — at which point a line labelled "now" sitting a day behind the end of the
                // data is worse than no label. It marks where the judged, complete data stops.
                label: {
                  formatter: opts.nowLabel ?? "COMPLETE",
                  color: AXIS_TEXT,
                  fontSize: 8,
                  position: "insideEndTop",
                },
                // Must use the same formatter as the axis data above, or the marker matches nothing.
                data: [{ xAxis: weekdayShort(opts.days[nowIdx]) }],
              }
            : undefined,
      },
      ...(opts.projection
        ? [{
            name: "Projection",
            type: "line" as const,
            data: opts.projection,
            smooth: 0.2,
            showSymbol: false,
            connectNulls: false,
            lineStyle: { width: 1.5, type: "dashed" as const, color: PROJECTION_GREY },
            z: 2,
          }]
        : []),
      // Above the actual (z:4) so the join is visible where they meet, and symbol-ended so today's
      // point is a point rather than a line that trails off ambiguously.
      ...(opts.today
        ? [{
            // "Achieved · today", not "Today so far": the series data is CUMULATIVE (last complete
            // day + today's count), so the old name contradicted the "Today so far" figure on the
            // tile below by exactly the week-to-date. The tooltip is hand-built now, but the name
            // still has to be true.
            name: "Achieved · today",
            type: "line" as const,
            data: opts.today,
            showSymbol: true,
            symbolSize: 5,
            connectNulls: true,
            lineStyle: { width: 2, type: "dotted" as const, color: hero },
            itemStyle: { color: hero },
            z: 4,
          }]
        : []),
    ],
  };
}

/** Office mini chart (strawman screen 2): % of monthly target vs the straight pace line. */
export function pctPaceChart(opts: {
  days: string[];
  actualPct: Array<number | null>;
  targetPct: number[];
  color: string;
}): EChartsOption {
  return {
    animation: false,
    grid: { left: 34, right: 8, top: 8, bottom: 20, containLabel: true },
    tooltip: { trigger: "axis", valueFormatter: (v) => `${v}%` },
    xAxis: {
      type: "category",
      boundaryGap: false,
      data: opts.days.map(weekdayShort),
      axisLabel: { color: AXIS_TEXT, fontSize: 8, interval: 0, hideOverlap: true },
      axisLine: { lineStyle: { color: "rgba(0,0,0,0.08)" } },
    },
    yAxis: {
      type: "value",
      min: 0,
      axisLabel: { color: AXIS_TEXT, fontSize: 8, formatter: "{value}%" },
      splitLine: { lineStyle: { color: "rgba(0,0,0,0.05)" } },
    },
    series: [
      {
        name: "Pace",
        type: "line",
        data: opts.targetPct,
        showSymbol: false,
        lineStyle: { width: 1.2, type: "dashed", color: PACE_GREY },
      },
      {
        name: "Actual",
        type: "line",
        data: opts.actualPct,
        smooth: 0.3,
        showSymbol: false,
        connectNulls: false,
        lineStyle: { width: 2, color: opts.color },
        itemStyle: { color: opts.color },
        areaStyle: { color: opts.color, opacity: 0.08 },
      },
    ],
  };
}

/** Momentum weekly trend (strawman screen 5): gradient-filled main line + reference line.
 *  `estimatedIndex` marks a point as an extrapolated week-to-date estimate (the still-in-progress
 *  current week, scaled up from partial data) — smooths the line as Conor asked (2026-07-07: don't
 *  let the current week visually "dip" until Friday), while a small "(est.)" marker keeps it honest. */
export function momentumChart(opts: {
  weeks: string[];
  values: Array<number | null>;
  color?: string;
  referenceLine?: { value: number; label: string };
  estimatedIndex?: number;
}): EChartsOption {
  const color = opts.color ?? NAVY;
  const estimatedPoint =
    opts.estimatedIndex != null
      ? { week: opts.weeks[opts.estimatedIndex], value: opts.values[opts.estimatedIndex] }
      : null;
  return {
    animation: false,
    grid: { left: 44, right: 14, top: 18, bottom: 24, containLabel: true },
    tooltip: { trigger: "axis" },
    xAxis: {
      type: "category",
      boundaryGap: false,
      data: opts.weeks,
      axisLabel: { color: AXIS_TEXT, fontSize: 9 },
      axisLine: { lineStyle: { color: "rgba(0,0,0,0.1)" } },
    },
    yAxis: {
      type: "value",
      axisLabel: { color: AXIS_TEXT, fontSize: 9 },
      splitLine: { lineStyle: { color: "rgba(0,0,0,0.06)" } },
      scale: true,
    },
    series: [
      {
        type: "line",
        data: opts.values,
        smooth: 0.3,
        showSymbol: opts.weeks.length <= 16,
        symbolSize: 4,
        connectNulls: false,
        lineStyle: { width: 2.5, color },
        itemStyle: { color },
        areaStyle: {
          color: {
            type: "linear",
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: `${color}22` },
              { offset: 1, color: `${color}00` },
            ],
          },
        },
        markLine: opts.referenceLine
          ? {
              symbol: "none",
              silent: true,
              lineStyle: { color: PROJECTION_GREY, type: "dashed", width: 1 },
              label: { formatter: opts.referenceLine.label, color: AXIS_TEXT, fontSize: 8, position: "insideEndTop" },
              data: [{ yAxis: opts.referenceLine.value }],
            }
          : undefined,
        markPoint:
          estimatedPoint && estimatedPoint.value != null
            ? {
                symbol: "circle",
                symbolSize: 7,
                itemStyle: { color: "#fff", borderColor: color, borderWidth: 2 },
                label: { formatter: "est.", position: "top", color: AXIS_TEXT, fontSize: 9, fontWeight: 700 },
                data: [{ name: "est", coord: [estimatedPoint.week, estimatedPoint.value] }],
              }
            : undefined,
      },
    ],
  };
}

/** Weekly Revenue's forecast redesign (item 12, reframed 2026-07-07): actuals stop at the last
 *  COMPLETE week — no extrapolated point pretending to be real, unlike the other 3 Momentum
 *  series. The current, in-progress week instead shows a dashed forecast segment (a two-point
 *  line from the last actual point to the day-by-day blended forecast), shrinking toward the true
 *  total as real days land. Same `paceChart`/`projectionSeries` pattern already used on the run
 *  chase — actual + a separate null-padded projection series, not one array doing both jobs. */
export function momentumForecastChart(opts: {
  weeks: string[];
  actual: Array<number | null>;
  forecast: Array<number | null>;
  color?: string;
  referenceLine?: { value: number; label: string };
}): EChartsOption {
  const color = opts.color ?? GREEN;
  let forecastIdx = -1;
  for (let i = 0; i < opts.forecast.length; i++) if (opts.forecast[i] != null) forecastIdx = i;
  const forecastValue = forecastIdx >= 0 ? opts.forecast[forecastIdx] : null;
  return {
    animation: false,
    grid: { left: 44, right: 14, top: 18, bottom: 24, containLabel: true },
    tooltip: { trigger: "axis" },
    xAxis: {
      type: "category",
      boundaryGap: false,
      data: opts.weeks,
      axisLabel: { color: AXIS_TEXT, fontSize: 9 },
      axisLine: { lineStyle: { color: "rgba(0,0,0,0.1)" } },
    },
    yAxis: {
      type: "value",
      axisLabel: { color: AXIS_TEXT, fontSize: 9 },
      splitLine: { lineStyle: { color: "rgba(0,0,0,0.06)" } },
      scale: true,
    },
    series: [
      {
        name: "Actual",
        type: "line",
        data: opts.actual,
        smooth: 0.3,
        showSymbol: opts.weeks.length <= 16,
        symbolSize: 4,
        connectNulls: false,
        lineStyle: { width: 2.5, color },
        itemStyle: { color },
        areaStyle: {
          color: {
            type: "linear",
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: `${color}22` },
              { offset: 1, color: `${color}00` },
            ],
          },
        },
        markLine: opts.referenceLine
          ? {
              symbol: "none",
              silent: true,
              lineStyle: { color: PROJECTION_GREY, type: "dashed", width: 1 },
              label: { formatter: opts.referenceLine.label, color: AXIS_TEXT, fontSize: 8, position: "insideEndTop" },
              data: [{ yAxis: opts.referenceLine.value }],
            }
          : undefined,
        z: 2,
      },
      {
        name: "Forecast",
        type: "line",
        data: opts.forecast,
        showSymbol: true,
        symbolSize: 5,
        connectNulls: false,
        lineStyle: { width: 2, type: "dashed", color },
        itemStyle: { color: "#fff", borderColor: color, borderWidth: 2 },
        markPoint:
          forecastValue != null
            ? {
                symbol: "circle",
                symbolSize: 7,
                itemStyle: { color: "#fff", borderColor: color, borderWidth: 2 },
                label: { formatter: "est.", position: "top", color: AXIS_TEXT, fontSize: 9, fontWeight: 700 },
                data: [{ name: "est", coord: [opts.weeks[forecastIdx], forecastValue] }],
              }
            : undefined,
        z: 3,
      },
    ],
  };
}

const FUNNEL_COLORS = ["#0E2040", "#1D4ED8", "#2563EB", "#3B82F6", "#93C5FD"];

/** Funnel Health's top bar (item 10): a real tapering funnel shape, not a row of equal-width
 *  boxes. `sort: "none"` preserves the given stage order — this is a flow, not a ranking, so
 *  ECharts' default sort-by-value would scramble it. */
export function funnelStagesChart(items: Array<{ name: string; value: number; label: string }>): EChartsOption {
  return {
    animation: false,
    tooltip: { trigger: "item", formatter: "{b}: {c}" },
    series: [
      {
        type: "funnel",
        sort: "none",
        left: "4%",
        right: "4%",
        top: 12,
        bottom: 12,
        gap: 6,
        // Stage volumes here drop off sharply and non-monotonically (Referrals/Protection Sales
        // are a parallel track, not later mortgage-pipeline steps) — a strictly value-proportional
        // width would make the smaller stages too thin for their label. minSize guarantees every
        // stage stays readable at the cost of exact proportionality.
        minSize: "22%",
        maxSize: "100%",
        label: { show: true, position: "inside", color: "#fff", fontSize: 12, fontWeight: 700, lineHeight: 16 },
        labelLine: { show: false },
        itemStyle: { borderColor: "#fff", borderWidth: 1 },
        data: items.map((it, i) => ({
          name: it.name,
          value: it.value,
          label: { formatter: it.label },
          itemStyle: { color: FUNNEL_COLORS[i % FUNNEL_COLORS.length] },
        })),
      },
    ],
  };
}

const CARD_BG = "#FFFFFF"; // matches --surface — see the masking trick below

/** Applications-vs-Referrals gap (Funnel Health, item 9 reframed): the visual gap between the two
 *  lines IS the unreferred opportunity — same red/green language the page already uses elsewhere
 *  (green = referred, red = not yet referred). Standard ECharts "fill only between two lines"
 *  technique: Applications fills down to 0 in the gap colour; Referrals re-fills its OWN area in
 *  the card's background colour on top, masking out everything below it and leaving only the band
 *  between the two lines visible. Not a stack — both areas independently fill to the 0 baseline. */
export function applicationsReferralsGapChart(opts: {
  weeks: string[];
  applications: number[];
  referrals: number[];
}): EChartsOption {
  return {
    animation: false,
    grid: { left: 44, right: 14, top: 30, bottom: 26 },
    tooltip: { trigger: "axis" },
    legend: {
      data: ["Mortgages Written", "Protection Referrals"],
      top: 0,
      right: 4,
      itemWidth: 12,
      itemHeight: 8,
      textStyle: { color: AXIS_TEXT, fontSize: 10 },
    },
    xAxis: {
      type: "category",
      boundaryGap: false,
      data: opts.weeks,
      axisLabel: { color: AXIS_TEXT, fontSize: 9, interval: Math.max(0, Math.floor(opts.weeks.length / 8)) },
      axisLine: { lineStyle: { color: "rgba(0,0,0,0.1)" } },
    },
    yAxis: {
      type: "value",
      min: 0,
      axisLabel: { color: AXIS_TEXT, fontSize: 9 },
      splitLine: { lineStyle: { color: "rgba(0,0,0,0.06)" } },
    },
    series: [
      {
        name: "Mortgages Written",
        type: "line",
        data: opts.applications,
        showSymbol: false,
        smooth: 0.25,
        connectNulls: false,
        lineStyle: { width: 2.5, color: NAVY },
        itemStyle: { color: NAVY },
        areaStyle: { color: "rgba(220,38,38,0.14)" },
        z: 1,
      },
      {
        name: "Protection Referrals",
        type: "line",
        data: opts.referrals,
        showSymbol: false,
        smooth: 0.25,
        connectNulls: false,
        lineStyle: { width: 2.5, color: GREEN },
        itemStyle: { color: GREEN },
        areaStyle: { color: CARD_BG },
        z: 2,
      },
    ],
  };
}
