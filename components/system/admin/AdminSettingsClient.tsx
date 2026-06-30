"use client";

import React from "react";

import { fetchSystemJson } from "@/lib/system/clientFetch";
import appPackage from "../../../package.json";

const READ_KEY = "fxlocus_desktop_package_read_version";

type DesktopMeta = {
  version: string;
  builtAt?: string;
};

type MobileMeta = {
  version: string;
  builtAt?: string;
};

export function AdminSettingsClient({ locale }: { locale: "zh" | "en" }) {
  const [desktopMeta, setDesktopMeta] = React.useState<DesktopMeta | null>(null);
  const [desktopMetaError, setDesktopMetaError] = React.useState(false);
  const [mobileMeta, setMobileMeta] = React.useState<MobileMeta | null>(null);
  const [mobileMetaError, setMobileMetaError] = React.useState(false);
  const [readVersion, setReadVersion] = React.useState<string | null>(null);

  const appVersion = String(appPackage.version || "0.1.0");

  React.useEffect(() => {
    const stored = window.localStorage.getItem(READ_KEY);
    setReadVersion(stored);
  }, []);

  React.useEffect(() => {
    let active = true;
    const loadMeta = async () => {
      try {
        const result = await fetchSystemJson<{ ok?: boolean; version?: string; builtAt?: string }>(
          "/api/system/desktop/latest?json=1",
          {
            dedupeKey: "desktop:latest",
            dedupeWindowMs: 2000,
            retries: 1,
            retryBaseMs: 220,
            retryMaxMs: 900
          }
        );
        const data = (result.body || null) as any;
        if (!active) return;
        if (result.ok && data?.ok && data?.version) {
          setDesktopMeta({ version: String(data.version), builtAt: data.builtAt });
          setDesktopMetaError(false);
        } else {
          setDesktopMeta(null);
          setDesktopMetaError(true);
        }
      } catch {
        if (!active) return;
        setDesktopMeta(null);
        setDesktopMetaError(true);
      }
    };
    void loadMeta();
    return () => {
      active = false;
    };
  }, []);

  React.useEffect(() => {
    let active = true;
    const loadMobileMeta = async () => {
      try {
        const result = await fetchSystemJson<{ ok?: boolean; version?: string; builtAt?: string }>(
          "/api/system/mobile/latest?json=1&platform=android",
          {
            fresh: true,
            dedupeKey: "mobile:latest:admin-settings",
            dedupeWindowMs: 2000,
            retries: 1,
            retryBaseMs: 220,
            retryMaxMs: 900
          }
        );
        const data = (result.body || null) as any;
        if (!active) return;
        if (result.ok && data?.ok && data?.version) {
          setMobileMeta({ version: String(data.version), builtAt: data.builtAt });
          setMobileMetaError(false);
        } else {
          setMobileMeta(null);
          setMobileMetaError(true);
        }
      } catch {
        if (!active) return;
        setMobileMeta(null);
        setMobileMetaError(true);
      }
    };
    void loadMobileMeta();
    return () => {
      active = false;
    };
  }, []);

  const needsPackage = desktopMetaError || !desktopMeta || desktopMeta.version !== appVersion;
  const isRead = readVersion === appVersion;
  const showBadge = needsPackage && !isRead;

  const markRead = () => {
    window.localStorage.setItem(READ_KEY, appVersion);
    setReadVersion(appVersion);
    window.dispatchEvent(new CustomEvent("fxdesktop:read", { detail: { version: appVersion } }));
  };

  const statusText = needsPackage
    ? locale === "zh"
      ? "需要重新打包并发布桌面端"
      : "Desktop build required"
    : locale === "zh"
      ? "桌面端已是最新版本"
      : "Desktop build is up to date";

  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
      <div className="text-white/90 font-semibold text-xl">{locale === "zh" ? "系统设置" : "Settings"}</div>
      <div className="mt-2 text-white/60 text-sm">
        {locale === "zh"
          ? "在此查看桌面端版本状态，并检查关键环境变量。"
          : "Check desktop build status and key environment variables here."}
      </div>

      <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="text-white/85 font-semibold">{locale === "zh" ? "桌面端版本状态" : "Desktop build status"}</div>
          {showBadge ? (
            <span className="inline-flex items-center rounded-full bg-rose-500/90 px-2 py-0.5 text-[11px] font-semibold text-white">
              {locale === "zh" ? "待打包" : "Build required"}
            </span>
          ) : null}
        </div>
        <div className="mt-3 grid gap-2 text-sm text-white/70">
          <div>
            {locale === "zh" ? "系统版本：" : "App version: "}
            <span className="text-white/90">{appVersion}</span>
          </div>
          <div>
            {locale === "zh" ? "安装包版本：" : "Installer version: "}
            <span className="text-white/90">{desktopMeta?.version || "-"}</span>
          </div>
          {desktopMeta?.builtAt ? (
            <div>
              {locale === "zh" ? "打包时间：" : "Built at: "}
              <span className="text-white/80">{desktopMeta.builtAt}</span>
            </div>
          ) : null}
          <div className={needsPackage ? "text-rose-300" : "text-emerald-300"}>{statusText}</div>
        </div>
        {needsPackage ? (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <code className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-white/70">
              npm run desktop:package
            </code>
            <code className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-white/70">
              npm run desktop:release
            </code>
            <button
              type="button"
              onClick={markRead}
              className="inline-flex items-center rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/80 hover:bg-white/10"
            >
              {locale === "zh" ? "已阅" : "Mark as read"}
            </button>
          </div>
        ) : null}
      </div>

      <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="text-white/85 font-semibold">{locale === "zh" ? "安卓测试包" : "Android test package"}</div>
          {mobileMetaError ? (
            <span className="inline-flex items-center rounded-full bg-rose-500/90 px-2 py-0.5 text-[11px] font-semibold text-white">
              {locale === "zh" ? "未上传" : "Missing"}
            </span>
          ) : null}
        </div>
        <div className="mt-3 grid gap-2 text-sm text-white/70">
          <div>
            {locale === "zh" ? "安装包版本：" : "Package version: "}
            <span className="text-white/90">{mobileMeta?.version || "-"}</span>
          </div>
          {mobileMeta?.builtAt ? (
            <div>
              {locale === "zh" ? "打包时间：" : "Built at: "}
              <span className="text-white/80">{mobileMeta.builtAt}</span>
            </div>
          ) : null}
          <div className="text-white/52">
            {locale === "zh"
              ? "安卓下载入口暂只放在超管设置页，测试通过后再开放到网页顶部。"
              : "Android download is limited to super admin settings until mobile testing passes."}
          </div>
        </div>
        <div className="mt-4">
          <a
            href="/api/system/mobile/latest?platform=android"
            className="inline-flex items-center rounded-xl border border-sky-300/20 bg-sky-400/10 px-4 py-2 text-sm font-semibold text-sky-100 hover:bg-sky-400/16"
          >
            {locale === "zh" ? "下载安卓测试包" : "Download Android test APK"}
          </a>
        </div>
      </div>

      <div className="mt-6 rounded-3xl border border-white/10 bg-white/5 p-6 text-sm text-white/70 leading-7">
        <div className="text-white/85 font-semibold mb-2">{locale === "zh" ? "环境变量检查" : "Environment variables"}</div>
        <ul className="list-disc pl-5 space-y-1">
          <li>DB (D1 binding)</li>
          <li>R2_BUCKET</li>
          <li>R2_ENDPOINT</li>
          <li>R2_ACCESS_KEY_ID</li>
          <li>R2_SECRET_ACCESS_KEY</li>
          <li>R2_DESKTOP_PREFIX</li>
          <li>SYSTEM_FILES_BUCKET</li>
          <li>SYSTEM_CLASSIC_TRADES_BUCKET</li>
          <li>SYSTEM_WEEKLY_SUMMARIES_BUCKET</li>
          <li>SYSTEM_CONSULT_BUCKET</li>
          <li>TRADE_LOG_RETENTION_SECRET (cron, optional)</li>
          <li>R2_CDN_BASE_URL (optional)</li>
          <li>OPENAI_API_KEY (optional)</li>
          <li>APP_BASE_URL (optional)</li>
          <li>NEXT_PUBLIC_TRADINGVIEW_SCRIPT_HOST (optional)</li>
        </ul>
      </div>
    </div>
  );
}
