"use client";

import React from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import { Download, Globe, LogOut, RefreshCw, Settings, SlidersHorizontal, X } from "lucide-react";

import { SystemTopRightControls } from "@/components/system/SystemTopRightControls";
import { fetchSystemJson } from "@/lib/system/clientFetch";
import { stopSystemMusic } from "@/lib/system/musicControl";
import type { SystemRole } from "@/lib/system/roles";

type Props = {
  locale: "zh" | "en";
  user: { full_name: string | null; role: SystemRole };
  forceMobileApp?: boolean;
};

function getRoleLabel(locale: "zh" | "en", role: SystemRole) {
  if (locale === "en") {
    switch (role) {
      case "super_admin":
        return "Super Admin";
      case "leader":
        return "Leader";
      case "trader":
        return "Data Collector";
      case "coach":
        return "Coach";
      case "assistant":
        return "Assistant";
      default:
        return "Student";
    }
  }

  switch (role) {
    case "super_admin":
      return "超管";
    case "leader":
      return "团队长";
    case "trader":
      return "数据采集员";
    case "coach":
      return "教练";
    case "assistant":
      return "助教";
    default:
      return "学员";
  }
}

function clampScalePercent(value: number) {
  return Math.min(100, Math.max(1, Math.round(value)));
}

function toScaleString(percent: number) {
  const normalized = clampScalePercent(percent);
  const scale = 0.88 + ((normalized - 1) / 99) * 0.12;
  return scale.toFixed(3);
}

function compareSemverLike(a: string, b: string) {
  const parse = (value: string) =>
    String(value || "")
      .split(".")
      .map((part) => Number(part.replace(/[^\d].*$/, "")) || 0);
  const left = parse(a);
  const right = parse(b);
  const max = Math.max(left.length, right.length);
  for (let i = 0; i < max; i += 1) {
    const diff = (left[i] || 0) - (right[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function Topbar({ locale, user, forceMobileApp = false }: Props) {
  const router = useRouter();
  const pathname = usePathname() || `/${locale}/system/notifications`;
  const [loading, setLoading] = React.useState(false);
  const [isMobileApp, setIsMobileApp] = React.useState(forceMobileApp);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [mobileFontScalePercent, setMobileFontScalePercent] = React.useState(100);
  const [mobileVersionStatus, setMobileVersionStatus] = React.useState<{
    checking?: boolean;
    checked?: boolean;
    latest?: boolean;
    current?: string;
    remote?: string;
    error?: string;
  }>({});

  React.useEffect(() => {
    if (forceMobileApp) {
      setIsMobileApp(true);
      return;
    }
    const sync = () => {
      setIsMobileApp(
        document.documentElement.getAttribute("data-mobile-app") === "1" && window.innerWidth <= 767
      );
    };
    sync();
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
  }, [forceMobileApp]);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const storedPercent = Number(window.localStorage.getItem("fxlocus.mobile.fontScalePercent") || 100);
    const nextPercent = Number.isFinite(storedPercent) ? clampScalePercent(storedPercent) : 100;
    setMobileFontScalePercent(nextPercent);
    document.documentElement.style.setProperty("--mobile-font-scale", toScaleString(nextPercent));
  }, []);

  const swapLocalePath = React.useCallback(
    (nextLocale: "zh" | "en") => pathname.replace(/^\/(zh|en)(?=\/|$)/, `/${nextLocale}`),
    [pathname]
  );

  const changeMobileLocale = React.useCallback(
    (nextLocale: "zh" | "en") => {
      try {
        window.localStorage.setItem("fxlocus.mobile.locale", nextLocale);
      } catch {
        // ignore
      }
      setSettingsOpen(false);
      if (nextLocale !== locale) {
        router.replace(swapLocalePath(nextLocale));
      }
    },
    [locale, router, swapLocalePath]
  );

  const changeMobileFontScale = React.useCallback((nextPercent: number) => {
    const normalized = clampScalePercent(nextPercent);
    setMobileFontScalePercent(normalized);
    document.documentElement.style.setProperty("--mobile-font-scale", toScaleString(normalized));
    try {
      window.localStorage.setItem("fxlocus.mobile.fontScalePercent", String(normalized));
    } catch {
      // ignore
    }
  }, []);

  const getMobileCurrentVersion = React.useCallback(async () => {
    try {
      const appPlugin = (window as any)?.Capacitor?.Plugins?.App;
      if (appPlugin?.getInfo) {
        const info = await appPlugin.getInfo();
        if (info?.version) return String(info.version);
      }
    } catch {
      // fall through to user agent parsing
    }
    const matched = String(navigator.userAgent || "").match(/FxLocusMobile\/([0-9.]+)/i);
    return matched?.[1] || "";
  }, []);

  const checkMobileVersion = React.useCallback(async () => {
    setMobileVersionStatus((prev) => ({ ...prev, checking: true, error: "" }));
    try {
      const [current, result] = await Promise.all([
        getMobileCurrentVersion(),
        fetchSystemJson<{ ok?: boolean; version?: string }>("/api/system/mobile/latest?json=1&platform=android", {
          fresh: true,
          dedupeKey: "mobile:latest:android",
          dedupeWindowMs: 0,
          retries: 1,
          retryBaseMs: 260,
          retryMaxMs: 1200,
          staleTtlMs: 0
        })
      ]);
      const json = (result.body || null) as any;
      if (!result.ok || !json?.ok || !json?.version) throw new Error("CHECK_FAILED");
      const remote = String(json.version);
      setMobileVersionStatus({
        checking: false,
        checked: true,
        latest: Boolean(current) && compareSemverLike(current, remote) >= 0,
        current,
        remote
      });
    } catch {
      setMobileVersionStatus({
        checking: false,
        checked: true,
        latest: false,
        error: locale === "zh" ? "版本检测失败，请稍后重试" : "Version check failed. Please retry."
      });
    }
  }, [getMobileCurrentVersion, locale]);

  const downloadLatestAndroid = React.useCallback(async () => {
    const downloadUrl = new URL("/api/system/mobile/latest?platform=android", window.location.origin).toString();
    const plugin = (window as any)?.Capacitor?.Plugins?.FxLocusPermissions;
    if (plugin?.downloadAndInstallApk) {
      try {
        await plugin.downloadAndInstallApk({ url: downloadUrl });
        return;
      } catch (error: any) {
        const code = String(error?.message || error || "").toUpperCase();
        if (code.includes("INSTALL_PERMISSION_REQUIRED")) {
          setMobileVersionStatus((prev) => ({
            ...prev,
            error: locale === "zh" ? "请先允许安装未知来源应用，然后再次点击更新。" : "Allow installing unknown apps, then tap update again."
          }));
          return;
        }
      }
    }
    window.location.href = downloadUrl;
  }, [locale]);

  const logout = async () => {
    setLoading(true);
    try {
      stopSystemMusic({ resetSource: true, clearSavedState: true });
      await fetch("/api/system/auth/logout", { method: "POST" });
    } finally {
      setSettingsOpen(false);
      router.replace(`/${locale}/system/login`);
      setLoading(false);
    }
  };

  const roleLabel = getRoleLabel(locale, user.role);
  const userName = user.full_name || (locale === "zh" ? "用户" : "User");

  return (
    <div
      className="system-topbar relative z-30 flex items-center border-b border-[color:var(--border)] bg-[color:var(--panel)] backdrop-blur"
      style={{
        height: "var(--system-topbar-height)",
        paddingLeft: "var(--system-topbar-padding-x)",
        paddingRight: "var(--system-topbar-padding-x)",
        gap: "var(--system-topbar-gap)"
      }}
    >
      <div className="system-topbar-user flex min-w-0 flex-col gap-0.5">
        <div className="truncate text-sm text-white/86">
          {userName}
          <span className="ml-2 text-xs text-white/42">{roleLabel}</span>
        </div>
      </div>

      <div className="system-topbar-actions ml-auto flex items-center gap-2">
        {isMobileApp ? (
          <>
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="inline-flex h-11 w-11 items-center justify-center rounded-[22px] border border-white/10 bg-white/[0.04] text-white/84 transition hover:bg-white/[0.08]"
              aria-label={locale === "zh" ? "设置" : "Settings"}
            >
              <Settings className="h-4.5 w-4.5" />
            </button>
            {settingsOpen && typeof document !== "undefined"
              ? createPortal(
                  <div className="fixed inset-0 z-[220]" data-mobile-settings-sheet="1">
                    <button
                      type="button"
                      className="absolute inset-0 bg-black/60 backdrop-blur-[4px]"
                      aria-label={locale === "zh" ? "关闭设置" : "Close settings"}
                      onClick={() => setSettingsOpen(false)}
                    />
                    <aside className="absolute inset-y-0 right-0 flex h-full w-[86vw] max-w-[360px] flex-col border-l border-white/10 bg-[#0c121c] px-4 pb-[calc(env(safe-area-inset-bottom)+20px)] pt-[calc(env(safe-area-inset-top)+18px)] shadow-[-20px_0_48px_rgba(0,0,0,0.36)]">
                      <div className="mb-4 flex items-center justify-between">
                        <div className="text-base font-semibold text-white">{locale === "zh" ? "设置" : "Settings"}</div>
                        <button
                          type="button"
                          onClick={() => setSettingsOpen(false)}
                          className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-white/76"
                          aria-label={locale === "zh" ? "关闭设置" : "Close settings"}
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>

                      <div className="flex-1 space-y-4 overflow-y-auto">
                        <section className="rounded-[22px] border border-white/10 bg-white/[0.03] p-4">
                          <div className="mb-3 flex items-center gap-2 text-xs text-white/48">
                            <Globe className="h-3.5 w-3.5" />
                            <span>{locale === "zh" ? "语言" : "Language"}</span>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            {[
                              { value: "zh" as const, label: "中文" },
                              { value: "en" as const, label: "English" }
                            ].map((item) => (
                              <button
                                key={item.value}
                                type="button"
                                onClick={() => changeMobileLocale(item.value)}
                                className={[
                                  "rounded-2xl border px-3 py-2.5 text-sm transition",
                                  locale === item.value
                                    ? "border-sky-300/28 bg-sky-400/12 text-sky-100"
                                    : "border-white/10 bg-white/[0.04] text-white/72"
                                ].join(" ")}
                              >
                                {item.label}
                              </button>
                            ))}
                          </div>
                        </section>

                        <section className="rounded-[22px] border border-white/10 bg-white/[0.03] p-4">
                          <div className="mb-3 flex items-center gap-2 text-xs text-white/48">
                            <SlidersHorizontal className="h-3.5 w-3.5" />
                            <span>{locale === "zh" ? "字体大小" : "Font size"}</span>
                          </div>
                          <div className="mb-2 flex items-center justify-between text-[11px] text-white/52">
                            <span>{locale === "zh" ? "小" : "Small"}</span>
                            <span>{mobileFontScalePercent}%</span>
                            <span>{locale === "zh" ? "中" : "Medium"}</span>
                          </div>
                          <input
                            type="range"
                            min={1}
                            max={100}
                            step={1}
                            value={mobileFontScalePercent}
                            onChange={(event) => changeMobileFontScale(Number(event.target.value))}
                            className="w-full accent-sky-400"
                          />
                        </section>

                        <section className="rounded-[22px] border border-white/10 bg-white/[0.03] p-4">
                          <div className="mb-3 flex items-center gap-2 text-xs text-white/48">
                            <RefreshCw className="h-3.5 w-3.5" />
                            <span>{locale === "zh" ? "版本检测" : "Version check"}</span>
                          </div>
                          <button
                            type="button"
                            onClick={checkMobileVersion}
                            disabled={mobileVersionStatus.checking}
                            className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white/82 transition hover:bg-white/[0.08] disabled:opacity-50"
                          >
                            <RefreshCw className={["h-4 w-4", mobileVersionStatus.checking ? "animate-spin" : ""].join(" ")} />
                            <span>
                              {mobileVersionStatus.checking
                                ? locale === "zh"
                                  ? "检测中..."
                                  : "Checking..."
                                : locale === "zh"
                                  ? "检查最新版本"
                                  : "Check for updates"}
                            </span>
                          </button>
                          {mobileVersionStatus.checked ? (
                            <div
                              className={[
                                "mt-3 rounded-2xl border px-3 py-2 text-xs leading-5",
                                mobileVersionStatus.latest
                                  ? "border-emerald-300/18 bg-emerald-400/10 text-emerald-100"
                                  : "border-amber-300/18 bg-amber-400/10 text-amber-100"
                              ].join(" ")}
                            >
                              {mobileVersionStatus.error ||
                                (mobileVersionStatus.latest
                                  ? locale === "zh"
                                    ? "已是最新版本"
                                    : "Already up to date"
                                  : locale === "zh"
                                    ? `发现新版本：${mobileVersionStatus.remote || "-"}`
                                    : `New version available: ${mobileVersionStatus.remote || "-"}`)}
                              {!mobileVersionStatus.latest && !mobileVersionStatus.error ? (
                                <button
                                  type="button"
                                  onClick={downloadLatestAndroid}
                                  className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-sky-400/18 px-3 py-2 font-semibold text-sky-100"
                                >
                                  <Download className="h-3.5 w-3.5" />
                                  <span>{locale === "zh" ? "下载并安装最新版" : "Download latest"}</span>
                                </button>
                              ) : null}
                            </div>
                          ) : null}
                        </section>

                        <section className="rounded-[22px] border border-white/10 bg-white/[0.03] p-4">
                          <button
                            type="button"
                            disabled={loading}
                            onClick={logout}
                            className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white/82 transition hover:bg-white/[0.08] disabled:opacity-50"
                          >
                            <LogOut className="h-4 w-4" />
                            <span>{locale === "zh" ? "退出系统" : "Logout"}</span>
                          </button>
                        </section>
                      </div>
                    </aside>
                  </div>,
                  document.body
                )
              : null}
          </>
        ) : (
          <>
            <SystemTopRightControls locale={locale} />
            <button
              type="button"
              disabled={loading}
              onClick={logout}
              className="system-topbar-logout rounded-xl border border-[color:var(--border)] bg-[color:var(--panel)] px-3 py-1.5 text-white/80 hover:bg-[color:var(--panel-2)] disabled:opacity-50"
            >
              {locale === "zh" ? "退出系统" : "Logout"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
