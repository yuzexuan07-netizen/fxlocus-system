"use client";

import React from "react";

import { acquireGlobalPollSlot } from "@/lib/system/clientPolling";
import { SYSTEM_REALTIME_EVENT, type SystemRealtimeDetail } from "@/lib/system/realtime";

type RefreshOptions = {
  throttleMs?: number;
  globalThrottleMs?: number;
  includeSidebarCounts?: boolean;
  tables?: string[];
  dedupeKey?: string;
  refreshOnFocus?: boolean;
};

const GLOBAL_LAST_AT = new Map<string, number>();
const GLOBAL_INFLIGHT = new Set<string>();

export function useSystemRealtimeRefresh(
  handler: (detail?: SystemRealtimeDetail) => void | Promise<void>,
  options: number | RefreshOptions = 800
) {
  const handlerRef = React.useRef(handler);
  const lastRef = React.useRef(0);
  const pendingRef = React.useRef(false);
  const throttleMs = typeof options === "number" ? options : options?.throttleMs ?? 800;
  const globalThrottleMs = typeof options === "number" ? throttleMs : options?.globalThrottleMs ?? throttleMs;
  const includeSidebarCounts = typeof options === "number" ? false : Boolean(options?.includeSidebarCounts);
  const refreshOnFocus = typeof options === "number" ? true : options?.refreshOnFocus !== false;
  const tables = Array.isArray((options as RefreshOptions | undefined)?.tables)
    ? (options as RefreshOptions).tables!.filter(Boolean)
    : [];
  const tablesKey = tables.join("|");
  const dedupeKey = typeof options === "number" ? "" : String(options?.dedupeKey || "");
  const globalKey = dedupeKey || `tables:${tablesKey || "__all__"}|sidebar:${includeSidebarCounts ? "1" : "0"}`;
  const crossTabSlotKey = `realtime:${globalKey}`;
  const crossTabThrottleMs = Math.max(throttleMs, globalThrottleMs);

  React.useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  React.useEffect(() => {
    const tableSet = tablesKey ? new Set(tablesKey.split("|")) : null;
    const tryRun = (detail?: SystemRealtimeDetail) => {
      const table = String(detail?.table || "");
      if (detail) {
        if (!includeSidebarCounts && table === "sidebar_counts") return;
        if (tableSet && !tableSet.has(table)) return;
      }
      const now = Date.now();
      if (now - lastRef.current < throttleMs) return;
      const globalLast = Number(GLOBAL_LAST_AT.get(globalKey) || 0);
      if (now - globalLast < globalThrottleMs) return;
      if (!acquireGlobalPollSlot(crossTabSlotKey, crossTabThrottleMs)) return;
      if (pendingRef.current || GLOBAL_INFLIGHT.has(globalKey)) return;
      lastRef.current = now;
      GLOBAL_LAST_AT.set(globalKey, now);
      pendingRef.current = true;
      GLOBAL_INFLIGHT.add(globalKey);
      Promise.resolve(handlerRef.current(detail))
        .catch(() => {
          // keep silent in realtime callback
        })
        .finally(() => {
          pendingRef.current = false;
          GLOBAL_INFLIGHT.delete(globalKey);
        });
    };
    const onEvent = (event: Event) => {
      const detail = (event as CustomEvent).detail as SystemRealtimeDetail | undefined;
      tryRun(detail);
    };
    const onFocusRefresh = () => {
      if (!refreshOnFocus) return;
      if (document.visibilityState !== "visible") return;
      tryRun(undefined);
    };
    window.addEventListener(SYSTEM_REALTIME_EVENT, onEvent);
    window.addEventListener("focus", onFocusRefresh);
    window.addEventListener("pageshow", onFocusRefresh);
    document.addEventListener("visibilitychange", onFocusRefresh);
    return () => {
      window.removeEventListener(SYSTEM_REALTIME_EVENT, onEvent);
      window.removeEventListener("focus", onFocusRefresh);
      window.removeEventListener("pageshow", onFocusRefresh);
      document.removeEventListener("visibilitychange", onFocusRefresh);
    };
  }, [
    crossTabSlotKey,
    crossTabThrottleMs,
    globalKey,
    globalThrottleMs,
    includeSidebarCounts,
    refreshOnFocus,
    tablesKey,
    throttleMs
  ]);
}
