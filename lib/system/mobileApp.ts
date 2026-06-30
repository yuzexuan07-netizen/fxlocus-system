import { headers } from "next/headers";

export function isFxLocusMobileUserAgent(userAgent: string | null | undefined) {
  return /FxLocusMobile/i.test(String(userAgent || ""));
}

export function isMobileAppRequest() {
  return isFxLocusMobileUserAgent(headers().get("user-agent"));
}
