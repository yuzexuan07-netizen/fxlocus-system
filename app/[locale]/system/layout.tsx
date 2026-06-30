import React from "react";
import Script from "next/script";
import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { cookies } from "next/headers";

import { SiteThemeProvider } from "@/components/site-theme/SiteThemeProvider";
import { SystemShell } from "@/components/system/SystemShell";
import {
  getScheduledSiteTheme,
  SITE_THEME_ALTERNATION_ANCHOR_DATE,
  SITE_THEME_SCHEDULE_TIME_ZONE
} from "@/lib/site-theme/siteThemeConfig";
import { getDefaultSystemThemeForSiteTheme, isSystemTheme } from "@/lib/system/themes";

export const metadata: Metadata = {
  title: "系统 / System",
  robots: {
    index: false,
    follow: false
  }
};

const SYSTEM_BOOTSTRAP = `(() => {
  try {
    const path = window.location.pathname || "";
    const isSystem = path.includes("/system");
    const isAuth =
      path.includes("/system/login") ||
      path.includes("/system/forgot-password") ||
      path.includes("/system/reset-password");
    if (!isSystem) return;
    const root = document.documentElement;
    const body = document.body;
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "${SITE_THEME_SCHEDULE_TIME_ZONE}",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(new Date());
    const year = Number(parts.find((part) => part.type === "year")?.value);
    const month = Number(parts.find((part) => part.type === "month")?.value);
    const day = Number(parts.find((part) => part.type === "day")?.value);
    const [anchorYear, anchorMonth, anchorDay] = "${SITE_THEME_ALTERNATION_ANCHOR_DATE}"
      .split("-")
      .map(Number);
    const currentDayIndex = Math.floor(Date.UTC(year, month - 1, day) / 86400000);
    const anchorDayIndex = Math.floor(Date.UTC(anchorYear, anchorMonth - 1, anchorDay) / 86400000);
    const siteTheme = Math.abs(currentDayIndex - anchorDayIndex) % 2 === 0 ? "theme-1" : "theme-2";
    root.dataset.siteTheme = siteTheme;
    root.dataset.backgroundVariant = siteTheme === "theme-2" ? "ember-cloud" : "points-ripple";
    if (body) {
      body.dataset.siteTheme = siteTheme;
      body.dataset.backgroundVariant = root.dataset.backgroundVariant;
    }
    if (isAuth) {
      root.dataset.systemAuth = "1";
      root.classList.add("system-auth-mode");
      if (body) {
        body.dataset.systemAuth = "1";
        body.classList.add("system-auth-mode");
      }
      return;
    }
    root.classList.add("system-mode");
    body?.classList.add("system-mode");
    root.dataset.systemRoute = "1";
    if (body) {
      body.dataset.systemRoute = "1";
    }
    const cookieMatch = document.cookie
      ? document.cookie.match(/(?:^|; )system\\.theme=([^;]+)/)
      : null;
    const cookieTheme = cookieMatch ? decodeURIComponent(cookieMatch[1]) : null;
    const theme =
      (window.localStorage ? window.localStorage.getItem("system.theme") : null) ||
      cookieTheme ||
      (siteTheme === "theme-2" ? "nebula" : "ember");
    root.dataset.theme = theme;
    if (body) {
      body.dataset.theme = theme;
    }
  } catch {}
})();`;

async function getSystemHeaderMessages(locale: "zh" | "en") {
  if (locale === "en") {
    const [common] = await Promise.all([
      import("@/messages/en/common.json")
    ]);
    return { common: common.default };
  }

  const [common] = await Promise.all([
    import("@/messages/zh/common.json")
  ]);
  return { common: common.default };
}

export default async function SystemLayout({
  children,
  params
}: {
  children: React.ReactNode;
  params: { locale: "zh" | "en" };
}) {
  const locale = params.locale === "en" ? "en" : "zh";
  const messages = await getSystemHeaderMessages(locale);
  const scheduledSiteTheme = getScheduledSiteTheme(new Date(), SITE_THEME_SCHEDULE_TIME_ZONE);
  const cookieTheme = cookies().get("system.theme")?.value || "";
  const initialTheme = isSystemTheme(cookieTheme)
    ? cookieTheme
    : getDefaultSystemThemeForSiteTheme(scheduledSiteTheme);

  return (
    <>
      <Script id="system-bootstrap" strategy="beforeInteractive" dangerouslySetInnerHTML={{ __html: SYSTEM_BOOTSTRAP }} />
      <NextIntlClientProvider locale={locale} messages={messages}>
        <SiteThemeProvider>
          <SystemShell locale={locale} initialTheme={initialTheme}>
            {children}
          </SystemShell>
        </SiteThemeProvider>
      </NextIntlClientProvider>
    </>
  );
}
