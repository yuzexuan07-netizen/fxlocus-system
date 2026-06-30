export const MOBILE_PRIMARY_TAB_HREFS = [
  "/system/notifications",
  "/system/consult",
  "/system/store",
  "/system/admin/trade-logs",
  "/system/admin/courses",
  "/system/coach/trade-logs",
  "/system/coach/courses",
  "/system/assistant/trade-logs",
  "/system/assistant/courses",
  "/system/profile"
] as const;

export type MobilePrimaryTabHref = (typeof MOBILE_PRIMARY_TAB_HREFS)[number];

export const MOBILE_PRIMARY_TAB_EVENT = "fxlocus:mobile-primary-tab-change";
export const MOBILE_PRIMARY_TAB_STORAGE_KEY = "fxlocus.mobile.primary-tab";

declare global {
  interface Window {
    __fxlocusMobilePrimaryHref?: MobilePrimaryTabHref;
  }
}

export function normalizeMobileTabPathname(pathname: string) {
  const withoutLocale = pathname.replace(/^\/(zh|en)(?=\/|$)/, "");
  const withLeadingSlash = withoutLocale.startsWith("/") ? withoutLocale : `/${withoutLocale}`;
  const normalized = withLeadingSlash === "//" ? "/" : withLeadingSlash;
  if (normalized === "" || normalized === "/") return "/";
  return normalized.replace(/\/+$/, "");
}

export function isMobilePrimaryTabHref(pathname: string): pathname is MobilePrimaryTabHref {
  const normalized = normalizeMobileTabPathname(pathname);
  return MOBILE_PRIMARY_TAB_HREFS.includes(normalized as MobilePrimaryTabHref);
}

export function isMobileApprovalRole(role: string) {
  return role === "super_admin" || role === "leader" || role === "coach" || role === "assistant";
}

export function getMobileApprovalBasePath(role: string) {
  if (role === "assistant") return "/system/assistant";
  if (role === "coach") return "/system/coach";
  return "/system/admin";
}

export function getMobileDefaultPrimaryHref(role: string): MobilePrimaryTabHref {
  return "/system/notifications";
}

export function getMobileRolePrimaryHrefs(role: string): MobilePrimaryTabHref[] {
  if (isMobileApprovalRole(role)) {
    const base = getMobileApprovalBasePath(role);
    return [
      "/system/notifications",
      "/system/consult",
      `${base}/trade-logs` as MobilePrimaryTabHref,
      `${base}/courses` as MobilePrimaryTabHref,
      "/system/profile"
    ];
  }
  return ["/system/notifications", "/system/consult", "/system/store", "/system/profile"];
}

export function sanitizeMobilePrimaryTabHref(
  rawHref: string | null | undefined,
  role: string
): MobilePrimaryTabHref | null {
  const normalized = normalizeMobileTabPathname(rawHref || "");
  if (!isMobilePrimaryTabHref(normalized)) return null;

  const approvalPath =
    normalized === "/system/admin/trade-logs" ||
    normalized === "/system/admin/courses" ||
    normalized === "/system/coach/trade-logs" ||
    normalized === "/system/coach/courses" ||
    normalized === "/system/assistant/trade-logs" ||
    normalized === "/system/assistant/courses";

  if (!isMobileApprovalRole(role)) {
    return approvalPath ? null : normalized;
  }

  if (normalized === "/system/store") {
    const base = getMobileApprovalBasePath(role);
    return `${base}/trade-logs` as MobilePrimaryTabHref;
  }

  if (!approvalPath) return normalized;

  const base = getMobileApprovalBasePath(role);
  return normalized.startsWith(base) ? normalized : (`${base}/trade-logs` as MobilePrimaryTabHref);
}

function readStoredMobilePrimaryHref(role: string) {
  if (typeof window === "undefined") return null;
  try {
    return sanitizeMobilePrimaryTabHref(window.sessionStorage.getItem(MOBILE_PRIMARY_TAB_STORAGE_KEY), role);
  } catch {
    return null;
  }
}

export function getMobilePrimaryTabSnapshot(role: string, fallback?: MobilePrimaryTabHref) {
  if (typeof window === "undefined") return fallback || getMobileDefaultPrimaryHref(role);
  const fromMemory = sanitizeMobilePrimaryTabHref(window.__fxlocusMobilePrimaryHref, role);
  if (fromMemory) return fromMemory;
  const fromUrl = sanitizeMobilePrimaryTabHref(window.location.pathname, role);
  if (fromUrl) {
    window.__fxlocusMobilePrimaryHref = fromUrl;
    return fromUrl;
  }
  const fromStorage = readStoredMobilePrimaryHref(role);
  if (fromStorage) {
    window.__fxlocusMobilePrimaryHref = fromStorage;
    return fromStorage;
  }
  return fallback || getMobileDefaultPrimaryHref(role);
}

export function subscribeMobilePrimaryTab(listener: () => void) {
  if (typeof window === "undefined") return () => {};
  const notify = () => listener();
  window.addEventListener(MOBILE_PRIMARY_TAB_EVENT, notify as EventListener);
  window.addEventListener("storage", notify);
  window.addEventListener("popstate", notify);
  window.addEventListener("focus", notify);
  window.addEventListener("pageshow", notify);
  return () => {
    window.removeEventListener(MOBILE_PRIMARY_TAB_EVENT, notify as EventListener);
    window.removeEventListener("storage", notify);
    window.removeEventListener("popstate", notify);
    window.removeEventListener("focus", notify);
    window.removeEventListener("pageshow", notify);
  };
}

function notifyMobilePrimaryTabChange(href: MobilePrimaryTabHref) {
  const dispatch = () => {
    window.dispatchEvent(new CustomEvent(MOBILE_PRIMARY_TAB_EVENT, { detail: { href } }));
  };
  dispatch();
  window.requestAnimationFrame?.(dispatch);
  window.setTimeout(dispatch, 40);
}

export function setMobilePrimaryTabHref(
  href: string,
  options: {
    locale: "zh" | "en";
    role: string;
    replaceUrl?: boolean;
  }
) {
  if (typeof window === "undefined") return null;
  const safeHref = sanitizeMobilePrimaryTabHref(href, options.role);
  if (!safeHref) return null;

  window.__fxlocusMobilePrimaryHref = safeHref;
  try {
    window.sessionStorage.setItem(MOBILE_PRIMARY_TAB_STORAGE_KEY, safeHref);
  } catch {
    // ignore
  }
  if (options.replaceUrl !== false) {
    try {
      window.history.replaceState(window.history.state, "", `/${options.locale}${safeHref}`);
    } catch {
      // ignore
    }
  }
  notifyMobilePrimaryTabChange(safeHref);
  return safeHref;
}
