import type { BackgroundVariant } from "@/lib/background/backgroundConfig";

export const siteThemes = [
  {
    key: "theme-1",
    zh: "主题1",
    en: "Theme 1",
    backgroundVariant: "points-ripple"
  },
  {
    key: "theme-2",
    zh: "主题2",
    en: "Theme 2",
    backgroundVariant: "ember-cloud"
  }
] as const;

export type SiteTheme = (typeof siteThemes)[number]["key"];

export const SITE_THEME_STORAGE_KEY = "fxlocus:site-theme";
export const DEFAULT_SITE_THEME: SiteTheme = "theme-1";
export const SITE_THEME_SCHEDULE_TIME_ZONE = "Asia/Shanghai";
export const SITE_THEME_ALTERNATION_ANCHOR_DATE = "2026-03-23";

const backgroundVariantToSiteThemeMap: Record<BackgroundVariant, SiteTheme> = {
  "points-ripple": "theme-1",
  "ember-cloud": "theme-2"
};

const siteThemeToBackgroundVariantMap: Record<SiteTheme, BackgroundVariant> = {
  "theme-1": "points-ripple",
  "theme-2": "ember-cloud"
};

export function isSiteTheme(value: unknown): value is SiteTheme {
  return typeof value === "string" && siteThemes.some((item) => item.key === value);
}

export function getSiteThemeFromBackgroundVariant(
  variant: BackgroundVariant | null | undefined
): SiteTheme {
  if (!variant) return DEFAULT_SITE_THEME;
  return backgroundVariantToSiteThemeMap[variant] ?? DEFAULT_SITE_THEME;
}

export function getBackgroundVariantForSiteTheme(theme: SiteTheme): BackgroundVariant {
  return siteThemeToBackgroundVariantMap[theme] ?? siteThemeToBackgroundVariantMap[DEFAULT_SITE_THEME];
}

function getTimeZoneDateParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);

  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const day = Number(parts.find((part) => part.type === "day")?.value);

  return { year, month, day };
}

export function getScheduledSiteTheme(
  date: Date = new Date(),
  timeZone: string = SITE_THEME_SCHEDULE_TIME_ZONE
): SiteTheme {
  const { year, month, day } = getTimeZoneDateParts(date, timeZone);
  const [anchorYear, anchorMonth, anchorDay] = SITE_THEME_ALTERNATION_ANCHOR_DATE.split("-").map(Number);
  const currentDayIndex = Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
  const anchorDayIndex = Math.floor(Date.UTC(anchorYear, anchorMonth - 1, anchorDay) / 86_400_000);
  const offsetDays = currentDayIndex - anchorDayIndex;

  return Math.abs(offsetDays) % 2 === 0 ? "theme-1" : "theme-2";
}
