"use client";

import React from "react";

import { type BackgroundVariant } from "@/lib/background/backgroundConfig";
import {
  getBackgroundVariantForSiteTheme,
  getScheduledSiteTheme,
  type SiteTheme
} from "@/lib/site-theme/siteThemeConfig";

type SiteThemeContextValue = {
  theme: SiteTheme;
  backgroundVariant: BackgroundVariant;
  setTheme: (nextTheme: SiteTheme) => void;
};

const SiteThemeContext = React.createContext<SiteThemeContextValue | null>(null);

export function SiteThemeProvider({
  children,
  enabled = true
}: {
  children: React.ReactNode;
  enabled?: boolean;
}) {
  const [theme, setThemeState] = React.useState<SiteTheme>(() => getScheduledSiteTheme());
  const [backgroundVariant, setBackgroundVariant] = React.useState<BackgroundVariant>(
    getBackgroundVariantForSiteTheme(getScheduledSiteTheme())
  );

  React.useEffect(() => {
    if (!enabled) {
      if (typeof document !== "undefined") {
        const root = document.documentElement;
        root.removeAttribute("data-site-theme");
        root.removeAttribute("data-background-variant");
      }
      return;
    }

    const applyScheduledTheme = () => {
      const nextTheme = getScheduledSiteTheme();
      const nextBackgroundVariant = getBackgroundVariantForSiteTheme(nextTheme);
      setThemeState((current) => (current === nextTheme ? current : nextTheme));
      setBackgroundVariant((current) =>
        current === nextBackgroundVariant ? current : nextBackgroundVariant
      );
    };

    applyScheduledTheme();

    const onVisibilityChange = () => {
      if (!document.hidden) applyScheduledTheme();
    };
    const timer = window.setInterval(applyScheduledTheme, 60_000);
    window.addEventListener("focus", applyScheduledTheme);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", applyScheduledTheme);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [enabled]);

  React.useEffect(() => {
    if (!enabled || typeof document === "undefined") return;

    const root = document.documentElement;
    root.dataset.siteTheme = theme;
    root.dataset.backgroundVariant = backgroundVariant;
    return () => {
      if (root.dataset.siteTheme === theme) {
        root.removeAttribute("data-site-theme");
      }
      if (root.dataset.backgroundVariant === backgroundVariant) {
        root.removeAttribute("data-background-variant");
      }
    };
  }, [backgroundVariant, enabled, theme]);

  const setTheme = React.useCallback((_nextTheme: SiteTheme) => {
    // Site theme is schedule-driven and no longer manually switchable.
  }, []);

  const value = React.useMemo(
    () => ({
      theme,
      backgroundVariant,
      setTheme
    }),
    [backgroundVariant, setTheme, theme]
  );

  return <SiteThemeContext.Provider value={value}>{children}</SiteThemeContext.Provider>;
}

export function useSiteTheme() {
  const context = React.useContext(SiteThemeContext);
  if (!context) {
    throw new Error("useSiteTheme must be used within SiteThemeProvider");
  }
  return context;
}
