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
  AxisPointerComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { EChartsOption, ECElementEvent } from "echarts";

echarts.use([
  BarChart, LineChart, PieChart, FunnelChart, HeatmapChart, GaugeChart,
  GridComponent, TooltipComponent, LegendComponent, VisualMapComponent, MarkLineComponent, MarkAreaComponent, AxisPointerComponent,
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
    return () => {
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

  return <div ref={el} style={{ width: "100%", height }} />;
}
