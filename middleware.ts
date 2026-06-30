import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { defaultLocale } from "./i18n/routing";

function readEnvPositiveInt(key: string, fallback: number, min = 1, max = Number.MAX_SAFE_INTEGER) {
  const raw = Number(process.env[key] || "");
  if (!Number.isFinite(raw)) return fallback;
  const normalized = Math.floor(raw);
  if (normalized < min || normalized > max) return fallback;
  return normalized;
}

const RATE_WINDOW_LOGIN_MS = readEnvPositiveInt("MIDDLEWARE_LOGIN_RATE_WINDOW_MS", 60_000, 1000, 10 * 60 * 1000);
const RATE_LIMIT_LOGIN = readEnvPositiveInt("MIDDLEWARE_LOGIN_RATE_LIMIT_PER_IP", 80, 5, 10_000);
const SECURITY_RESPONSE_HEADERS: Readonly<Record<string, string>> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(self), microphone=(self), geolocation=(), payment=(), usb=()"
};
const NO_STORE_HEADERS: Readonly<Record<string, string>> = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  "CDN-Cache-Control": "no-store",
  "Cloudflare-CDN-Cache-Control": "no-store"
};
const PUBLIC_PAGE_CACHE_HEADERS: Readonly<Record<string, string>> = {
  "Cache-Control": "public, max-age=0, s-maxage=120, stale-while-revalidate=600",
  "CDN-Cache-Control": "public, s-maxage=120, stale-while-revalidate=600",
  "Cloudflare-CDN-Cache-Control": "public, s-maxage=120, stale-while-revalidate=600"
};
const CSP_REPORT_ONLY = [
  "default-src 'self' https: data: blob:",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https: blob:",
  "style-src 'self' 'unsafe-inline' https:",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: https:",
  "connect-src 'self' https: wss:",
  "media-src 'self' https: data: blob:",
  "frame-src 'self' https:",
  "frame-ancestors 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self' https:"
].join("; ");
const rateStore = new Map<string, { count: number; resetAt: number }>();

function getClientIp(request: NextRequest) {
  const forwarded = request.headers.get("x-forwarded-for") || "";
  const ip = forwarded.split(",")[0]?.trim();
  return ip || request.ip || "unknown";
}

function consumeRateBucket(key: string, now: number, limit: number, windowMs: number) {
  const entry = rateStore.get(key);
  if (!entry || entry.resetAt <= now) {
    rateStore.set(key, { count: 1, resetAt: now + windowMs });
    return { limited: false, retryAfterSec: 0 };
  }
  entry.count += 1;
  if (entry.count <= limit) return { limited: false, retryAfterSec: 0 };
  return { limited: true, retryAfterSec: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)) };
}

function applyRateLimit(request: NextRequest) {
  if (request.nextUrl.pathname !== "/api/system/auth/login") return null;
  const loginBucket = consumeRateBucket(
    `system-login:${getClientIp(request)}`,
    Date.now(),
    RATE_LIMIT_LOGIN,
    RATE_WINDOW_LOGIN_MS
  );
  if (!loginBucket.limited) return null;
  return NextResponse.json(
    { ok: false, error: "RATE_LIMITED" },
    {
      status: 429,
      headers: {
        "Retry-After": String(loginBucket.retryAfterSec),
        "Cache-Control": "no-store"
      }
    }
  );
}

function applyHeaders(response: NextResponse, headers: Readonly<Record<string, string>>) {
  for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
}

function finalizeResponse(request: NextRequest, response: NextResponse) {
  for (const [name, value] of Object.entries(SECURITY_RESPONSE_HEADERS)) {
    if (!response.headers.has(name)) response.headers.set(name, value);
  }
  if (!response.headers.has("Content-Security-Policy") && !response.headers.has("Content-Security-Policy-Report-Only")) {
    response.headers.set("Content-Security-Policy-Report-Only", CSP_REPORT_ONLY);
  }
  const proto = String(request.headers.get("x-forwarded-proto") || request.nextUrl.protocol || "").toLowerCase();
  if (proto.includes("https") && !response.headers.has("Strict-Transport-Security")) {
    response.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
  }
  return response;
}

export default async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-fxlocus-pathname", pathname);

  if (pathname.startsWith("/api/")) {
    const limited = applyRateLimit(request);
    return finalizeResponse(request, limited || NextResponse.next({ request: { headers: requestHeaders } }));
  }

  if (pathname === "/") {
    const url = request.nextUrl.clone();
    url.pathname = `/${defaultLocale}/system`;
    const redirect = NextResponse.redirect(url, 308);
    applyHeaders(redirect, NO_STORE_HEADERS);
    return finalizeResponse(request, redirect);
  }

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  const isSystemRoute = /^\/(zh|en)\/system(\/|$)/.test(pathname);
  const isSystemAuthRoute = /^\/(zh|en)\/system\/(login|forgot-password|reset-password)(\/|$)/.test(pathname);
  if (isSystemRoute) applyHeaders(response, isSystemAuthRoute ? PUBLIC_PAGE_CACHE_HEADERS : NO_STORE_HEADERS);
  return finalizeResponse(request, response);
}

export const config = {
  matcher: ["/", "/(zh|en)", "/(zh|en)/:path*", "/api/system/:path*"]
};
