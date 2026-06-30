import type { Metadata, Viewport } from "next";
import { cookies, headers } from "next/headers";
import Script from "next/script";
import "./globals.css";

import { OpenSourceWatermark } from "@/components/OpenSourceWatermark";
import type { Locale } from "@/i18n/routing";
import { isFxLocusMobileUserAgent } from "@/lib/system/mobileApp";
import { getScheduledSiteTheme } from "@/lib/site-theme/siteThemeConfig";
import { getDefaultSystemThemeForSiteTheme, isSystemTheme } from "@/lib/system/themes";

export const metadata: Metadata = {
  applicationName: "System",
  title: {
    default: "System",
    template: "%s | System"
  },
  robots: {
    index: false,
    follow: false
  },
  icons: {
    icon: [{ url: "/favicon.ico" }],
    shortcut: ["/favicon.ico"]
  }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#080b16"
};

export default function RootLayout({
  children,
  params
}: {
  children: React.ReactNode;
  params?: { locale?: Locale };
}) {
  const headerStore = headers();
  const cookieStore = cookies();
  const pathname = headerStore.get("x-fxlocus-pathname") || "";
  const pathnameLocale = pathname.match(/^\/(zh|en)(?:\/|$)/)?.[1] as Locale | undefined;
  const locale = pathnameLocale || (params?.locale === "en" ? "en" : "zh");
  const htmlLang = locale === "zh" ? "zh-CN" : "en";
  const fontClass = locale === "zh" ? "font-zh" : "font-en";
  const isMobileApp = isFxLocusMobileUserAgent(headerStore.get("user-agent"));
  const isSystemRoute = /^\/(zh|en)\/system(\/|$)/.test(pathname);
  const isSystemAuthRoute = /^\/(zh|en)\/system\/(login|forgot-password|reset-password)(\/|$)/.test(pathname);
  const isProtectedSystemRoute = isSystemRoute && !isSystemAuthRoute;
  const scheduledSiteTheme = getScheduledSiteTheme();
  const cookieSystemTheme = cookieStore.get("system.theme")?.value || "";
  const systemTheme = isSystemTheme(cookieSystemTheme)
    ? cookieSystemTheme
    : getDefaultSystemThemeForSiteTheme(scheduledSiteTheme);
  const sidebarCollapsed = cookieStore.get("fxlocus_system_sidebar_collapsed")?.value === "1";
  const htmlClassName = [
    fontClass,
    isProtectedSystemRoute ? "system-mode" : "",
    isProtectedSystemRoute ? "system-preboot" : "",
    isSystemAuthRoute ? "system-auth-mode" : ""
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <html
      lang={htmlLang}
      className={htmlClassName}
      data-mobile-app={isMobileApp ? "1" : undefined}
      data-site-theme={scheduledSiteTheme}
      data-background-variant={scheduledSiteTheme === "theme-2" ? "ember-cloud" : "points-ripple"}
      data-system-route={isProtectedSystemRoute ? "1" : undefined}
      data-system-auth={isSystemAuthRoute ? "1" : undefined}
      data-theme={isProtectedSystemRoute ? systemTheme : undefined}
      data-system-sidebar-collapsed={isProtectedSystemRoute ? (sidebarCollapsed ? "1" : "0") : undefined}
      suppressHydrationWarning
    >
      <head>
        <Script id="chunk-load-recovery" strategy="beforeInteractive">
          {`(function(){try{var KEY="__fx_chunk_retry_count__";var MAX_RETRY=1;var hasRetried=false;function shouldRetry(target){if(target instanceof HTMLScriptElement){return (target.src||"").indexOf("/_next/static/")!==-1;}if(target instanceof HTMLLinkElement){return target.rel==="stylesheet"&&(target.href||"").indexOf("/_next/static/")!==-1;}return false;}window.addEventListener("error",function(event){var target=event&&event.target;if(!shouldRetry(target))return;if(hasRetried)return;hasRetried=true;var retryCount=0;try{retryCount=Number(sessionStorage.getItem(KEY)||"0");}catch(_e){}if(retryCount>=MAX_RETRY)return;try{sessionStorage.setItem(KEY,String(retryCount+1));}catch(_e2){}var url=new URL(window.location.href);url.searchParams.set("__chunk_retry",Date.now().toString(36));window.location.replace(url.toString());},true);window.addEventListener("load",function(){try{sessionStorage.removeItem(KEY);}catch(_e){}},{once:true});}catch(_e){}})();`}
        </Script>
      </head>
      <body
        className={isProtectedSystemRoute ? "system-mode" : isSystemAuthRoute ? "system-auth-mode" : undefined}
        data-site-theme={scheduledSiteTheme}
        data-background-variant={scheduledSiteTheme === "theme-2" ? "ember-cloud" : "points-ripple"}
        data-system-route={isProtectedSystemRoute ? "1" : undefined}
        data-system-auth={isSystemAuthRoute ? "1" : undefined}
        data-theme={isProtectedSystemRoute ? systemTheme : undefined}
      >
        {children}
        {isSystemRoute ? <OpenSourceWatermark locale={locale} /> : null}
      </body>
    </html>
  );
}
