"use client";

import React from "react";

import { fetchSystemJson } from "@/lib/system/clientFetch";
import { acquireGlobalPollSlot } from "@/lib/system/clientPolling";
import { dispatchSystemRealtime } from "@/lib/system/realtime";

const DEFAULT_INTERVAL_MS = 25_000;
const GLOBAL_MIN_INTERVAL_MS = 15_000;

export function SystemRealtimeSync() {
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = React.useRef(false);
  const lastHashRef = React.useRef<string>("");
  const aliveRef = React.useRef(true);
  const hashStorageKey = "fxlocus.sidebar.hash";

  const schedule = React.useCallback(async () => {
    if (!aliveRef.current) return;
    if (pendingRef.current) return;
    if (!acquireGlobalPollSlot("system:sidebar-counts", GLOBAL_MIN_INTERVAL_MS)) return;
    pendingRef.current = true;
    try {
      const result = await fetchSystemJson("/api/system/sidebar-counts?fresh=1", {
        dedupeKey: "sidebar:counts:sync",
        dedupeWindowMs: 250,
        retries: 1,
        fresh: true,
        preferStale: false,
        revalidateInBackground: false,
        staleTtlMs: 0,
        allowStaleOnRateLimit: false,
        allowStaleOnServerError: false
      });
      const json = (result.body || null) as any;
      if (!result.ok || !json?.ok) return;
      const hash = JSON.stringify({
        unread: json.unread ?? 0,
        consultUnread: json.consultUnread ?? 0,
        pending: json.pending ?? {}
      });
      if (!hash) return;
      if (!lastHashRef.current) {
        lastHashRef.current = hash;
        if (typeof window !== "undefined") {
          try {
            window.localStorage.setItem(hashStorageKey, hash);
          } catch {
            // ignore storage failures
          }
        }
        return;
      }
      if (hash !== lastHashRef.current) {
        lastHashRef.current = hash;
        if (typeof window !== "undefined") {
          try {
            window.localStorage.setItem(hashStorageKey, hash);
          } catch {
            // ignore storage failures
          }
        }
        dispatchSystemRealtime({ table: "sidebar_counts", action: "update" });
      }
    } catch {
      // ignore
    } finally {
      pendingRef.current = false;
    }
  }, []);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    aliveRef.current = true;
    try {
      const savedHash = window.localStorage.getItem(hashStorageKey);
      if (savedHash) lastHashRef.current = savedHash;
    } catch {
      // ignore
    }
    void schedule();

    const onFocus = () => {
      if (document.hidden) return;
      void schedule();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);

    const scheduleNext = (baseMs: number) => {
      if (!aliveRef.current) return;
      const jitterMs = Math.floor(baseMs * 0.2);
      const nextMs = baseMs + Math.floor(Math.random() * (jitterMs + 1));
      timerRef.current = setTimeout(() => {
        if (!aliveRef.current) return;
        if (!document.hidden) void schedule();
        scheduleNext(baseMs);
      }, nextMs);
    };

    const pollMs =
      typeof navigator !== "undefined" && (navigator as any).connection?.saveData
        ? 60_000
        : DEFAULT_INTERVAL_MS;
    scheduleNext(pollMs);
    return () => {
      aliveRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [schedule]);

  return null;
}
