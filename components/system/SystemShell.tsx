"use client";

import React from "react";
import { usePathname, useRouter } from "next/navigation";

import {
  isSystemTheme,
  systemThemes,
  type SystemTheme
} from "@/lib/system/themes";
import { stopSystemMusic } from "@/lib/system/musicControl";
import { FloatingMusicPlayer } from "@/components/system/FloatingMusicPlayer";

type SystemShellContextValue = {
  theme: SystemTheme;
  setTheme: (next: SystemTheme) => void;
  isFullscreen: boolean;
  toggleFullscreen: () => void;
};

const SystemShellContext = React.createContext<SystemShellContextValue | null>(null);

function safeStorageGet(key: string) {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeStorageSet(key: string, value: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // ignore storage failures (private mode, denied, etc.)
  }
}

function safeCookieSet(key: string, value: string, maxAgeDays = 365) {
  if (typeof document === "undefined") return;
  const maxAge = Math.max(1, Math.floor(maxAgeDays * 24 * 60 * 60));
  const secure = typeof location !== "undefined" && location.protocol === "https:" ? "; secure" : "";
  document.cookie = `${key}=${encodeURIComponent(value)}; path=/; max-age=${maxAge}; samesite=lax${secure}`;
}

export function useSystemShell() {
  const ctx = React.useContext(SystemShellContext);
  if (!ctx) throw new Error("SystemShellContext not found");
  return ctx;
}

function isAuthPage(pathname: string) {
  return (
    pathname.includes("/system/login") ||
    pathname.includes("/system/forgot-password") ||
    pathname.includes("/system/reset-password")
  );
}

export function SystemShell({
  locale,
  initialTheme,
  children
}: {
  locale: "zh" | "en";
  initialTheme?: SystemTheme;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname() || "";
  const [theme, setTheme] = React.useState<SystemTheme>(() => {
    if (initialTheme && isSystemTheme(initialTheme)) return initialTheme;
    const ember = systemThemes.find((item) => item.key === "ember")?.key;
    return ember ?? systemThemes[0]?.key ?? "ember";
  });
  const [themeStorageReady, setThemeStorageReady] = React.useState(false);
  const [isFullscreen, setIsFullscreen] = React.useState(false);
  const windowPath = typeof window !== "undefined" ? window.location.pathname || "" : "";
  const currentPath = pathname || windowPath;
  const systemPath = currentPath.includes("/system");
  const authPath = currentPath ? isAuthPage(currentPath) : false;
  const systemActive = systemPath && !authPath;

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    if (!authPath) return;
    stopSystemMusic({ resetSource: true, clearSavedState: true });
  }, [authPath]);

  const ensureSystemMode = React.useCallback(() => {
    if (typeof document === "undefined" || !systemActive) return;
    const root = document.documentElement;
    const body = document.body;
    root.classList.add("system-mode");
    body.classList.add("system-mode");
    root.dataset.systemRoute = "1";
    body.dataset.systemRoute = "1";
  }, [systemActive]);
  const setThemeValue = React.useCallback(
    (next: SystemTheme) => {
      if (!isSystemTheme(next)) return;
      setTheme(next);
      if (typeof document !== "undefined" && systemActive) {
        ensureSystemMode();
        const root = document.documentElement;
        const body = document.body;
        root.dataset.theme = next;
        body.dataset.theme = next;
      }
    },
    [ensureSystemMode, systemActive]
  );

  React.useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    const body = document.body;
    root.classList.remove("system-preboot");
    if (!systemActive) {
      root.classList.remove("system-mode", "system-fullscreen");
      body.classList.remove("system-mode", "system-fullscreen");
      root.removeAttribute("data-theme");
      root.removeAttribute("data-system-route");
      body.removeAttribute("data-theme");
      body.removeAttribute("data-system-route");
      setIsFullscreen(false);
      return;
    }
    ensureSystemMode();
    return () => {
      root.classList.remove("system-mode", "system-fullscreen");
      body.classList.remove("system-mode", "system-fullscreen");
      root.removeAttribute("data-theme");
      root.removeAttribute("data-system-route");
      body.removeAttribute("data-theme");
      body.removeAttribute("data-system-route");
    };
  }, [ensureSystemMode, systemActive]);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    if (themeStorageReady) return;
    const storedTheme = safeStorageGet("system.theme");
    if (storedTheme && isSystemTheme(storedTheme) && storedTheme !== theme) {
      setThemeValue(storedTheme);
    }
    setThemeStorageReady(true);
  }, [setThemeValue, theme, themeStorageReady]);

  React.useEffect(() => {
    if (!themeStorageReady) return;
    safeStorageSet("system.theme", theme);
    safeCookieSet("system.theme", theme);
    if (!systemActive || typeof document === "undefined") return;
    const root = document.documentElement;
    const body = document.body;
    ensureSystemMode();
    root.dataset.theme = theme;
    body.dataset.theme = theme;
  }, [ensureSystemMode, systemActive, theme, themeStorageReady]);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const isMobileApp =
      document.documentElement.getAttribute("data-mobile-app") === "1" && window.innerWidth <= 767;
    if (!isMobileApp) return;
    const storedLocale = safeStorageGet("fxlocus.mobile.locale");
    const nextLocale = storedLocale === "en" ? "en" : "zh";
    if (nextLocale !== locale && /^\/(zh|en)(?=\/|$)/.test(pathname)) {
      router.replace(pathname.replace(/^\/(zh|en)(?=\/|$)/, `/${nextLocale}`));
      return;
    }
    if (!storedLocale && locale !== "zh" && /^\/(zh|en)(?=\/|$)/.test(pathname)) {
      router.replace(pathname.replace(/^\/(zh|en)(?=\/|$)/, "/zh"));
    }
  }, [locale, pathname, router]);

  React.useEffect(() => {
    if (!systemActive || typeof document === "undefined") {
      setIsFullscreen(false);
      return;
    }
    const root = document.documentElement;
    const body = document.body;
    const handleFullscreenChange = () => {
      const active = Boolean(document.fullscreenElement);
      setIsFullscreen(active);
      ensureSystemMode();
      root.classList.toggle("system-fullscreen", active);
      body.classList.toggle("system-fullscreen", active);
    };
    handleFullscreenChange();
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, [ensureSystemMode, systemActive]);

  const applyCellTitle = React.useCallback((cell: Element) => {
    if (cell.querySelector("button, input, select, textarea, a")) return;
    const text = cell.textContent?.trim();
    if (!text) {
      cell.removeAttribute("title");
      return;
    }
    if (cell.getAttribute("title") !== text) {
      cell.setAttribute("title", text);
    }
  }, []);

  const applyTableTitles = React.useCallback(
    (root: ParentNode | null | undefined) => {
      if (typeof document === "undefined" || !systemActive) return;
      if (!root || typeof (root as ParentNode).querySelectorAll !== "function") return;
      const cells = root.querySelectorAll("table th, table td, .admin-table th, .admin-table td");
      cells.forEach((cell) => applyCellTitle(cell));
    },
    [applyCellTitle, systemActive]
  );

  React.useEffect(() => {
    if (!systemActive || typeof document === "undefined" || typeof MutationObserver === "undefined") return;
    const container = (document.querySelector(".system-content") as Element | null) || document.body;
    const hasTable = () => Boolean(container.querySelector("table, .admin-table"));
    if (!hasTable()) return;
    applyTableTitles(container);

    const pendingCells = new Set<Element>();
    let rafId = 0;
    const delayedPasses = [
      window.setTimeout(() => applyTableTitles(container), 350),
      window.setTimeout(() => applyTableTitles(container), 1200)
    ];

    const enqueueCell = (cell: Element | null) => {
      if (!cell) return;
      pendingCells.add(cell);
    };

    const enqueueFromNode = (node: Node | null) => {
      if (!node) return;
      if (node.nodeType === Node.TEXT_NODE) {
        const parent = node.parentElement;
        enqueueCell(parent ? parent.closest("th, td") : null);
        return;
      }
      if (!(node instanceof Element)) return;
      if (node.matches("th, td")) enqueueCell(node);
      const cells = node.querySelectorAll("th, td");
      cells.forEach((cell) => enqueueCell(cell));
      enqueueCell(node.closest("th, td"));
    };

    const flush = () => {
      rafId = 0;
      pendingCells.forEach((cell) => applyCellTitle(cell));
      pendingCells.clear();
    };

    const scheduleFlush = () => {
      if (rafId) return;
      rafId = window.requestAnimationFrame(flush);
    };

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        enqueueFromNode(mutation.target);
        mutation.addedNodes.forEach((node) => enqueueFromNode(node));
      }
      if (pendingCells.size) scheduleFlush();
    });
    observer.observe(container, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      if (rafId) window.cancelAnimationFrame(rafId);
      delayedPasses.forEach((timer) => window.clearTimeout(timer));
      pendingCells.clear();
    };
  }, [applyCellTitle, applyTableTitles, currentPath, systemActive]);

  const toggleFullscreen = React.useCallback(() => {
    if (typeof document === "undefined" || !systemActive) return;
    ensureSystemMode();
    if (document.fullscreenElement) {
      void document.exitFullscreen();
      return;
    }
    void document.documentElement.requestFullscreen();
  }, [ensureSystemMode, systemActive]);

  const value = React.useMemo(
    () => ({
      theme,
      setTheme: setThemeValue,
      isFullscreen,
      toggleFullscreen
    }),
    [isFullscreen, setThemeValue, theme, toggleFullscreen]
  );

  return (
    <SystemShellContext.Provider value={value}>
      {children}
      {systemActive ? <FloatingMusicPlayer locale={locale} /> : null}
    </SystemShellContext.Provider>
  );
}
