import { useEffect, useRef } from "react";
// Tree-shaken ECharts: register ONLY the charts/components we use (echarts/core), not the full
// `echarts` bundle — cuts the single-file build from ~1.2 MB to ~0.4 MB for a faster first paint.
import * as echarts from "echarts/core";
import { BarChart, LineChart, PieChart, FunnelChart, HeatmapChart, GaugeChart } from "echarts/charts";
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  VisualMapComponent,
  MarkLineComponent,
  MarkAreaComponent,
  MarkPointComponent,
  AxisPointerComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { EChartsOption, ECElementEvent } from "echarts";

echarts.use([
  BarChart, LineChart, PieChart, FunnelChart, HeatmapChart, GaugeChart,
  GridComponent, TooltipComponent, LegendComponent, VisualMapComponent, MarkLineComponent, MarkAreaComponent, MarkPointComponent, AxisPointerComponent,
  CanvasRenderer,
]);

interface Props {
  option: EChartsOption;
  height?: number;
  /** Click handler (e.g. cross-filtering on a bar/segment). Receives the ECharts click param. */
  onClick?: (params: ECElementEvent) => void;
}

/** Thin React wrapper around an ECharts instance: inits once, updates on option change, resizes. */
export function EChart({ option, height = 300, onClick }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<ReturnType<typeof echarts.init> | null>(null);

  useEffect(() => {
    if (!el.current) return;
    const instance = echarts.init(el.current);
    chart.current = instance;
    const resize = () => instance.resize();
    window.addEventListener("resize", resize);
    // A window listener alone is not enough: ECharts sizes its canvas once, at init, and a chart's CARD
    // changes height WITHOUT the window changing. Two ways that showed up, fixed independently on two
    // branches and reconciled here: the office table gaining a row squeezed the chart row above it and
    // the canvas spilled its axis labels over the card below; and Market Momentum's half-width chart
    // drew at its preferred 560px, leaving the bottom third of a 1080 wall card blank. Observing the
    // container catches every such relayout — and ECharts positions the canvas INSIDE the observed box,
    // so resizing cannot feed back into it and loop.
    const observer = new ResizeObserver(resize);
    observer.observe(el.current);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", resize);
      instance.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    chart.current?.setOption(option, true);
  }, [option]);

  useEffect(() => {
    const c = chart.current;
    if (!c) return;
    c.off("click");
    if (onClick) c.on("click", onClick as (params: unknown) => void);
  }, [onClick]);

  // `height` is a PREFERRED height, not a fixed one. It used to be fixed, so on a shorter viewport
  // the canvas overflowed its card and the x-axis labels rendered on top of whatever sat below —
  // "the graphs appear to be overlapping … looks very messy" (Kyle 2026-08-07). Flexing down inside
  // the card keeps the chart within its own bounds at any wall height.
  return <div ref={el} style={{ width: "100%", height, minHeight: 0, flex: "1 1 auto", overflow: "hidden" }} />;
}
