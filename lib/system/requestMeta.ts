import { UAParser } from "ua-parser-js";

export function getIpFromHeaders(headers: Headers) {
  const xff = headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]?.trim() || null;
  return headers.get("x-real-ip") || null;
}

export function getUserAgent(headers: Headers) {
  return headers.get("user-agent") || "";
}

export function parseDevice(ua: string) {
  const parsed = UAParser(ua);
  return {
    browser: parsed.browser,
    os: parsed.os,
    device: parsed.device,
    engine: parsed.engine
  };
}
