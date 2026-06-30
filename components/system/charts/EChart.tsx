"use client";

import React from "react";
import type { EChartsOption } from "echarts";

type Props = {
  option: EChartsOption;
  className?: string;
  style?: React.CSSProperties;
};

export function EChart({ option, className, style }: Props) {
  const elRef = React.useRef<HTMLDivElement | null>(null);
  const chartRef = React.useRef<any>(null);

  React.useEffect(() => {
    let disposed = false;
    let resizeObserver: ResizeObserver | null = null;

    const mount = async () => {
      const el = elRef.current;
      if (!el) return;

      const echarts = await import("echarts");
      await import("echarts-gl");
      if (disposed) return;

      chartRef.current = echarts.init(el, undefined, { renderer: "canvas" });
      chartRef.current.setOption(option, { notMerge: true, lazyUpdate: false });

      resizeObserver = new ResizeObserver(() => {
        try {
          chartRef.current?.resize();
        } catch {
          // ignore
        }
      });
      resizeObserver.observe(el);
    };

    mount();

    return () => {
      disposed = true;
      try {
        resizeObserver?.disconnect();
      } catch {
        // ignore
      }
      try {
        chartRef.current?.dispose?.();
      } catch {
        // ignore
      }
      chartRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    try {
      chartRef.current?.setOption?.(option, { notMerge: true, lazyUpdate: false });
    } catch {
      // ignore
    }
  }, [option]);

  return <div ref={elRef} className={className} style={style} />;
}

