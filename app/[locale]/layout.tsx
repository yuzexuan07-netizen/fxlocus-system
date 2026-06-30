import { setRequestLocale } from "next-intl/server";
import Script from "next/script";
import { notFound } from "next/navigation";

import { locales, type Locale } from "@/i18n/routing";
import {
  SITE_THEME_ALTERNATION_ANCHOR_DATE,
  SITE_THEME_SCHEDULE_TIME_ZONE
} from "@/lib/site-theme/siteThemeConfig";

type Props = {
  children: React.ReactNode;
  params: { locale: string };
};

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({ children, params }: Props) {
  const locale = params.locale as Locale;
  if (!locales.includes(locale)) notFound();

  setRequestLocale(locale);
  const safeLocale = locale === "en" ? "en" : "zh";
  const localeBootstrap = `(function(){try{var root=document.documentElement;var locale=${JSON.stringify(
    safeLocale
  )};root.lang=locale==="en"?"en":"zh-CN";root.classList.toggle("font-en",locale==="en");root.classList.toggle("font-zh",locale!=="en");}catch(e){}})();`;
  const systemModeBootstrap = `(function(){try{var root=document.documentElement;var body=document.body;var path=location.pathname||"";var isSystem=path.indexOf("/system")!==-1;var isAuth=/\\/system\\/(login|forgot-password|reset-password)(\\/|$)/.test(path);if(!isSystem)return;var parts=new Intl.DateTimeFormat("en-CA",{timeZone:${JSON.stringify(
    SITE_THEME_SCHEDULE_TIME_ZONE
  )},year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());var year=Number((parts.find(function(part){return part.type==="year";})||{}).value);var month=Number((parts.find(function(part){return part.type==="month";})||{}).value);var day=Number((parts.find(function(part){return part.type==="day";})||{}).value);var anchor=${JSON.stringify(
    SITE_THEME_ALTERNATION_ANCHOR_DATE
  )}.split("-").map(Number);var currentDayIndex=Math.floor(Date.UTC(year,month-1,day)/86400000);var anchorDayIndex=Math.floor(Date.UTC(anchor[0],anchor[1]-1,anchor[2])/86400000);var siteTheme=Math.abs(currentDayIndex-anchorDayIndex)%2===0?"theme-1":"theme-2";var backgroundVariant=siteTheme==="theme-2"?"ember-cloud":"points-ripple";root.setAttribute("data-site-theme",siteTheme);root.setAttribute("data-background-variant",backgroundVariant);if(body){body.setAttribute("data-site-theme",siteTheme);body.setAttribute("data-background-variant",backgroundVariant);}if(isAuth){root.setAttribute("data-system-auth","1");root.classList.add("system-auth-mode");if(body){body.setAttribute("data-system-auth","1");body.classList.add("system-auth-mode");}return;}root.classList.add("system-mode");root.setAttribute("data-system-route","1");if(body){body.classList.add("system-mode");body.setAttribute("data-system-route","1");}var cookie=document.cookie||"";var themeMatch=cookie.match(/(?:^|; )system\\.theme=([^;]+)/);var cookieTheme=themeMatch?decodeURIComponent(themeMatch[1]):"";var storageTheme="";try{storageTheme=window.localStorage?window.localStorage.getItem("system.theme")||"":"";}catch(e){}var fallbackTheme=siteTheme==="theme-2"?"nebula":"ember";var theme=storageTheme||cookieTheme||fallbackTheme;if(!/^(nebula|midnight|aurora|ember|jade|dune|arctic|ruby|sapphire|emerald|amber|tech|onyx)$/.test(theme)){theme=fallbackTheme;}root.setAttribute("data-theme",theme);if(body)body.setAttribute("data-theme",theme);var collapsedMatch=cookie.match(/(?:^|; )fxlocus_system_sidebar_collapsed=([^;]+)/);var cookieCollapsed=collapsedMatch?decodeURIComponent(collapsedMatch[1]):"";var storageCollapsed="";try{storageCollapsed=window.localStorage?window.localStorage.getItem("fxlocus_system_sidebar_collapsed")||"":"";}catch(e){}var collapsed=storageCollapsed||cookieCollapsed;root.setAttribute("data-system-sidebar-collapsed",collapsed==="1"?"1":"0");}catch(e){}})();`;

  return (
    <>
      <Script id="locale-bootstrap" strategy="beforeInteractive" dangerouslySetInnerHTML={{ __html: localeBootstrap }} />
      <Script id="system-mode-bootstrap" strategy="beforeInteractive" dangerouslySetInnerHTML={{ __html: systemModeBootstrap }} />
      {children}
    </>
  );
}
