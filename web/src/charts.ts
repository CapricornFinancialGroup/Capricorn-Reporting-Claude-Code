// ECharts option builders for the Growth OS chart vocabulary. Kept declarative so pages just
// supply data + colours. Colour language matches the strawman screens: dashed grey target pace,
// navy actual (amber when behind), dotted grey projection, NOW marker at the data-as-of day.

import type { EChartsOption } from "echarts";
import { shortDate } from "./format.js";

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

/**
 * Run-chase pace chart (strawman screen 1): straight dashed target-pace line, actual line with
 * area fill (navy when ahead/on-pace, amber when behind), dotted projection from "now" to the
 * projected finish, and a NOW marker on the data-as-of day.
 */
export function paceChart(opts: {
  days: string[];
  actual: Array<number | null>;
  targetPace: number[];
  projection: Array<number | null>;
  behind: boolean;
  nowLabel?: string;
}): EChartsOption {
  const hero = opts.behind ? AMBER : NAVY;
  const heroFill = opts.behind ? "rgba(217,119,6,0.06)" : "rgba(14,32,64,0.06)";
  let nowIdx = -1;
  for (let i = 0; i < opts.actual.length; i++) if (opts.actual[i] != null) nowIdx = i;
  return {
    grid: { left: 44, right: 14, top: 22, bottom: 26 },
    tooltip: { trigger: "axis" },
    xAxis: {
      type: "category",
      boundaryGap: false,
      data: opts.days.map(shortDate),
      axisLabel: { color: AXIS_TEXT, fontSize: 9, interval: Math.max(0, Math.floor(opts.days.length / 8)) },
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
        name: "Target pace",
        type: "line",
        data: opts.targetPace,
        showSymbol: false,
        lineStyle: { width: 1.5, type: "dashed", color: PACE_GREY },
        z: 1,
      },
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
                label: { formatter: "NOW", color: AXIS_TEXT, fontSize: 8, position: "insideEndTop" },
                data: [{ xAxis: shortDate(opts.days[nowIdx]) }],
              }
            : undefined,
      },
      {
        name: "Projection",
        type: "line",
        data: opts.projection,
        smooth: 0.2,
        showSymbol: false,
        connectNulls: false,
        lineStyle: { width: 1.5, type: "dashed", color: PROJECTION_GREY },
        z: 2,
      },
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
    grid: { left: 34, right: 8, top: 8, bottom: 20 },
    tooltip: { trigger: "axis", valueFormatter: (v) => `${v}%` },
    xAxis: {
      type: "category",
      boundaryGap: false,
      data: opts.days.map(shortDate),
      axisLabel: { color: AXIS_TEXT, fontSize: 8, interval: Math.max(0, Math.floor(opts.days.length / 5)) },
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
    grid: { left: 44, right: 14, top: 18, bottom: 24 },
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

/** Donut (strawman screen 4 protection opportunities). */
export function donutChart(items: Array<{ name: string; value: number; color: string }>): EChartsOption {
  return {
    tooltip: { trigger: "item", formatter: "{b}: {c} ({d}%)" },
    series: [
      {
        type: "pie",
        radius: ["62%", "85%"],
        itemStyle: { borderColor: "#fff", borderWidth: 2 },
        label: { show: false },
        data: items.map((it) => ({ name: it.name, value: it.value, itemStyle: { color: it.color } })),
      },
    ],
  };
}
