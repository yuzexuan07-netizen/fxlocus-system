import { NextRequest, NextResponse } from "next/server";
import { r2Enabled, r2ObjectExists, r2PresignGet } from "@/lib/storage/r2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const mobilePrefix = process.env.R2_MOBILE_PREFIX || "mobile";
const cdnBaseRaw = process.env.R2_CDN_BASE_URL || process.env.R2_PUBLIC_BASE_URL || "";
const cdnBase = cdnBaseRaw
  ? cdnBaseRaw.startsWith("http://") || cdnBaseRaw.startsWith("https://")
    ? cdnBaseRaw
    : `https://${cdnBaseRaw}`
  : "";
const iosDownloadUrl = normalizeUrl(process.env.IOS_DOWNLOAD_URL || process.env.NEXT_PUBLIC_IOS_DOWNLOAD_URL || "");

type MobilePackage = {
  url: string;
  fileName: string;
  sizeBytes: number | null;
};

type MobilePayload = {
  version: string;
  builtAt: string | null;
  packages: {
    android: MobilePackage;
    ios: MobilePackage;
  };
  metaUrl: string;
};

const CACHE_TTL_MS = 90_000;
const CACHE_KEY = "mobile-latest";
const g = globalThis as {
  __fx_mobile_latest_cache?: Map<string, { exp: number; payload: MobilePayload }>;
  __fx_mobile_latest_inflight?: Map<string, Promise<MobilePayload>>;
};
if (!g.__fx_mobile_latest_cache) g.__fx_mobile_latest_cache = new Map();
if (!g.__fx_mobile_latest_inflight) g.__fx_mobile_latest_inflight = new Map();

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: {
      "Cache-Control":
        status >= 400 ? "no-store" : "private, max-age=30, stale-while-revalidate=120"
    }
  });
}

function buildPublicUrl(key: string) {
  if (!cdnBase) return "";
  return `${cdnBase.replace(/\/+$/, "")}/${String(key || "").replace(/^\/+/, "")}`;
}

function normalizeUrl(value: unknown) {
  return String(value || "").trim();
}

function withDownloadVersion(url: string, payload: Pick<MobilePayload, "version" | "builtAt">) {
  const normalized = normalizeUrl(url);
  if (!normalized) return "";
  const token = normalizeUrl(payload.builtAt || payload.version || "");
  if (!token) return normalized;
  const separator = normalized.includes("?") ? "&" : "?";
  return `${normalized}${separator}v=${encodeURIComponent(token)}`;
}

function packagePayloadFromMeta(meta: any, platform: "android" | "ios") {
  const aliases = platform === "android" ? ["android", "apk"] : ["ios", "ipa"];
  const candidate = aliases
    .map((key) => meta?.packages?.[key])
    .find((item) => item && typeof item === "object");
  if (!candidate || typeof candidate !== "object") return null;
  const url = normalizeUrl(candidate.url || candidate.downloadUrl);
  if (!url) return null;
  return {
    url,
    fileName: normalizeUrl(candidate.fileName || candidate.name),
    sizeBytes: Number(candidate.sizeBytes || 0) || null
  };
}

async function loadMobilePayload() {
  const prefix = mobilePrefix.replace(/\/+$/, "");
  const metaKey = `${prefix}/mobile-package.json`;
  const androidKey = `${prefix}/fxlocus_android.apk`;
  const iosKey = `${prefix}/fxlocus_ios.ipa`;
  const metaUrl = buildPublicUrl(metaKey);
  const metaRes = metaUrl ? await fetch(metaUrl, { cache: "no-store" }).catch(() => null) : null;
  const meta = metaRes && metaRes.ok ? await metaRes.json().catch(() => null) : null;
  const androidFromMeta = packagePayloadFromMeta(meta, "android");
  const iosFromMeta = packagePayloadFromMeta(meta, "ios");
  const hasAndroidInR2 = await r2ObjectExists(androidKey);
  const hasIosInR2 = await r2ObjectExists(iosKey);
  const androidUrl = normalizeUrl(androidFromMeta?.url || (hasAndroidInR2 ? buildPublicUrl(androidKey) : ""));
  const iosUrl = normalizeUrl(iosDownloadUrl || iosFromMeta?.url || (hasIosInR2 ? buildPublicUrl(iosKey) : ""));

  return {
    version: String(meta?.version || ""),
    builtAt: String(meta?.builtAt || "") || null,
    packages: {
      android: {
        url: androidUrl,
        fileName: androidFromMeta?.fileName || "fxlocus_android.apk",
        sizeBytes: androidFromMeta?.sizeBytes || null
      },
      ios: {
        url: iosUrl,
        fileName: iosFromMeta?.fileName || "fxlocus_ios.ipa",
        sizeBytes: iosFromMeta?.sizeBytes || null
      }
    },
    metaUrl
  };
}

export async function GET(req: NextRequest) {
  const wantsJson = req.nextUrl.searchParams.get("json") === "1";
  const platformRaw = String(req.nextUrl.searchParams.get("platform") || "android").toLowerCase();
  const platform = ["ios", "iphone", "apple"].includes(platformRaw) ? "ios" : "android";
  const prefix = mobilePrefix.replace(/\/+$/, "");
  const key = platform === "ios" ? `${prefix}/fxlocus_ios.ipa` : `${prefix}/fxlocus_android.apk`;

  try {
    const now = Date.now();
    const cache = g.__fx_mobile_latest_cache!;
    const inflight = g.__fx_mobile_latest_inflight!;
    for (const [entryKey, entry] of cache.entries()) {
      if (entry.exp <= now) cache.delete(entryKey);
    }

    const cached = cache.get(CACHE_KEY);
    let payload = cached && cached.exp > now ? cached.payload : null;
    if (!payload) {
      let task = inflight.get(CACHE_KEY);
      if (!task) {
        task = loadMobilePayload();
        inflight.set(CACHE_KEY, task);
      }
      payload = await task.finally(() => inflight.delete(CACHE_KEY));
      cache.set(CACHE_KEY, { exp: Date.now() + CACHE_TTL_MS, payload });
    }

    if (wantsJson) {
      return json({ ok: true, ...payload });
    }

    const selected = payload.packages[platform];
    if (selected.url) {
      const res = NextResponse.redirect(withDownloadVersion(selected.url, payload), 302);
      res.headers.set("Cache-Control", "private, max-age=60");
      return res;
    }

    if (r2Enabled() && (await r2ObjectExists(key))) {
      const signed = await r2PresignGet(key, 3600);
      const res = NextResponse.redirect(signed, 302);
      res.headers.set("Cache-Control", "private, max-age=60");
      return res;
    }

    if (platform === "ios") {
      return new NextResponse(
        `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>iOS 下载暂未开放</title>
    <style>
      body{margin:0;min-height:100vh;display:grid;place-items:center;background:#050914;color:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
      .card{width:min(92vw,520px);border:1px solid rgba(255,255,255,.14);border-radius:24px;background:linear-gradient(180deg,rgba(31,21,45,.96),rgba(9,14,28,.96));padding:28px;box-shadow:0 24px 90px rgba(0,0,0,.45)}
      h1{margin:0 0 12px;font-size:24px}
      p{margin:10px 0;color:rgba(248,250,252,.72);line-height:1.75}
      a{display:inline-flex;margin-top:18px;border:1px solid rgba(255,255,255,.16);border-radius:14px;padding:10px 14px;color:#e0f2fe;text-decoration:none;background:rgba(255,255,255,.08)}
    </style>
  </head>
  <body>
    <main class="card">
      <h1>iOS 下载暂未开放</h1>
      <p>当前还没有发布可安装的 iOS 包。iPhone 端不能像 Android APK 一样直接下载安装，需要通过 TestFlight、App Store，或已签名的企业分发链接。</p>
      <p>配置 <code>IOS_DOWNLOAD_URL</code> 或 <code>NEXT_PUBLIC_IOS_DOWNLOAD_URL</code> 后，这个入口会自动跳转到正式 iOS 下载地址。</p>
      <a href="/zh/system/login">返回系统</a>
    </main>
  </body>
</html>`,
        {
          status: 200,
          headers: { "Cache-Control": "no-store", "Content-Type": "text/html; charset=utf-8" }
        }
      );
    }

    return new NextResponse("Android package not uploaded yet.", {
      status: 404,
      headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" }
    });
  } catch (e: any) {
    return json({ ok: false, error: e?.message || "FETCH_FAILED" }, 500);
  }
}
