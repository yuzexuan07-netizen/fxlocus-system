"use client";

import React from "react";

import LadderImage from "@/components/system/LadderImage";
import { fetchSystemJson } from "@/lib/system/clientFetch";
import { useSystemRealtimeRefresh } from "@/lib/system/useSystemRealtimeRefresh";

type LatestResponse =
  | { ok: true; authorized: boolean; status?: string; imageUrl: string | null; refreshMs: number }
  | { ok: false; error: string };

export function LadderViewer({ locale }: { locale: "zh" | "en" }) {
  const [data, setData] = React.useState<LatestResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [requesting, setRequesting] = React.useState(false);
  const [userId, setUserId] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setError(null);
    try {
      const result = await fetchSystemJson<LatestResponse>("/api/system/ladder/latest", {
        dedupeKey: "ladder-view:latest",
        retries: 2,
        retryBaseMs: 260,
        retryMaxMs: 1500
      });
      const json = (result.body || null) as LatestResponse | null;
      if (!result.ok || !json?.ok) throw new Error((json as any)?.error || result.errorCode || "load_failed");
      setData(json);
    } catch (e: any) {
      setError(e?.message || "load_failed");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  useSystemRealtimeRefresh(load, {
    tables: ["ladder_authorizations"],
    throttleMs: 3000,
    globalThrottleMs: 3800,
    dedupeKey: "ladder-view:latest"
  });

  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const result = await fetchSystemJson<{ ok?: boolean; user?: { id?: string | null } }>("/api/system/me", {
          dedupeKey: "ladder-view:me",
          retries: 1,
          retryBaseMs: 200,
          retryMaxMs: 1000
        });
        const json = (result.body || {}) as any;
        if (!alive) return;
        if (result.ok) setUserId(String(json.user?.id || ""));
      } catch {
        // ignore
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  React.useEffect(() => {
    if (userId) load();
  }, [load, userId]);

  const request = async () => {
    setRequesting(true);
    setError(null);
    try {
      const result = await fetchSystemJson("/api/system/ladder/request", {
        method: "POST",
        retries: 1,
        retryBaseMs: 220,
        retryMaxMs: 1200
      });
      if (!result.ok) throw new Error(result.errorCode || "request_failed");
      await load();
    } catch (e: any) {
      setError(e?.message || "request_failed");
    } finally {
      setRequesting(false);
    }
  };

  const status = data && "ok" in data && data.ok ? String(data.status || "none") : "none";
  const canRequest = !loading && data && "ok" in data && data.ok && !data.authorized && status !== "requested";

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
        <div className="text-white/90 font-semibold text-xl">{locale === "zh" ? "天梯" : "Ladder"}</div>
        <div className="mt-2 text-white/60 text-sm">
          {locale === "zh" ? "授权后可查看天梯图片。" : "View the ladder image after approval."}
        </div>
      </div>

      {loading ? (
        <div className="rounded-3xl border border-white/10 bg-white/5 p-6 text-white/60">
          {locale === "zh" ? "加载中..." : "Loading..."}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-3xl border border-rose-400/20 bg-rose-500/10 p-6 text-rose-100">
          {error}
        </div>
      ) : null}

      {!loading && data && "ok" in data && data.ok && data.authorized && data.imageUrl ? (
        <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
          <LadderImage
            baseUrl={data.imageUrl}
            intervalMs={data.refreshMs || 60000}
            showSource={false}
          />
        </div>
      ) : null}

      {!loading && data && "ok" in data && data.ok && !data.authorized ? (
        <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
          <div className="text-white/70 text-sm">
            {status === "requested"
              ? locale === "zh"
                ? "已申请，等待管理员审批。"
                : "Requested. Waiting for approval."
              : status === "rejected"
                ? locale === "zh"
                  ? "申请未通过，可重新申请。"
                  : "Rejected. You can request again."
                : locale === "zh"
                  ? "未开通天梯。"
                  : "Not enabled."}
          </div>
          {canRequest ? (
            <button
              type="button"
              disabled={requesting}
              onClick={request}
              className="mt-4 px-3 py-1.5 rounded-xl bg-white/10 border border-white/20 text-white hover:bg-white/15 disabled:opacity-50"
            >
              {locale === "zh" ? "申请天梯" : "Request ladder"}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
