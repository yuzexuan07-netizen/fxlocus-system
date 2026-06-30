"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { ClientDateTime } from "@/components/system/ClientDateTime";
import { acquireGlobalPollSlot } from "@/lib/system/clientPolling";

function withCacheBust(url: string, t: number) {
  const hasQuery = url.includes("?");
  return `${url}${hasQuery ? "&" : "?"}t=${t}`;
}

export default function LadderImage(props: {
  baseUrl: string;
  intervalMs?: number;
  className?: string;
  showSource?: boolean;
}) {
  const { baseUrl, intervalMs = 60000, className, showSource = true } = props;
  const [nonce, setNonce] = useState<number | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const pollSlotKey = useMemo(() => `ladder-image:${String(baseUrl || "").trim()}`, [baseUrl]);
  const frameRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const refresh = (force = false) => {
      if (!force && !acquireGlobalPollSlot(pollSlotKey, intervalMs)) return;
      setNonce(Date.now());
    };
    refresh(true);
    const timer = setInterval(() => refresh(false), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs, pollSlotKey]);

  useEffect(() => {
    const sync = () => {
      setFullscreen(document.fullscreenElement === frameRef.current);
    };
    sync();
    document.addEventListener("fullscreenchange", sync);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
    };
  }, []);

  const src = useMemo(() => (nonce ? withCacheBust(baseUrl, nonce) : baseUrl), [baseUrl, nonce]);

  const toggleFullscreen = async () => {
    const node = frameRef.current;
    if (!node) return;
    try {
      if (document.fullscreenElement === node) {
        await document.exitFullscreen();
        return;
      }
      await node.requestFullscreen();
    } catch {
      // ignore unsupported fullscreen failures
    }
  };

  return (
    <div className={className}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-sm opacity-80">
          自动刷新：{Math.round(intervalMs / 1000)} 秒 | 上次刷新：
          <ClientDateTime value={nonce ?? undefined} fallback="-" />
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="rounded-md border border-white/10 bg-white/5 px-3 py-1 hover:bg-white/10"
            onClick={toggleFullscreen}
          >
            {fullscreen ? "退出全屏" : "全屏查看"}
          </button>
          <button
            type="button"
            className="rounded-md border border-white/10 bg-white/5 px-3 py-1 hover:bg-white/10"
            onClick={() => setNonce(Date.now())}
          >
            手动刷新
          </button>
        </div>
      </div>

      <div
        ref={frameRef}
        className={[
          "rounded-xl border border-white/10 bg-black/20",
          fullscreen ? "flex h-full w-full items-center justify-center bg-black p-4" : ""
        ].join(" ")}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          key={nonce}
          src={src}
          alt="Ladder"
          className="w-full rounded-xl border border-white/10 bg-black/20"
          style={{ maxHeight: fullscreen ? "100vh" : "70vh", objectFit: "contain" }}
        />
      </div>

      {showSource ? (
        <div className="mt-2 break-all text-xs opacity-60">
          源地址：
          <a className="underline" href={baseUrl} target="_blank" rel="noreferrer">
            {baseUrl}
          </a>
        </div>
      ) : null}
    </div>
  );
}
