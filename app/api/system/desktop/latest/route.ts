import { NextRequest, NextResponse } from "next/server";
import { r2Enabled, r2ObjectExists, r2PresignGet } from "@/lib/storage/r2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const CACHE_TTL_MS = 90_000;
const CACHE_KEY = "desktop-latest";

const desktopPrefix = process.env.R2_DESKTOP_PREFIX || "desktop";
const cdnBaseRaw = process.env.R2_CDN_BASE_URL || process.env.R2_PUBLIC_BASE_URL || "";
const cdnBase = cdnBaseRaw
  ? cdnBaseRaw.startsWith("http://") || cdnBaseRaw.startsWith("https://")
    ? cdnBaseRaw
    : `https://${cdnBaseRaw}`
  : "";

type DesktopPackage = {
  url: string;
  fileName: string;
  sizeBytes: number | null;
};

type DesktopPayload = {
  version: string;
  builtAt: string | null;
  downloadUrl: string;
  packages: {
    windows: DesktopPackage;
    mac: DesktopPackage;
  };
  metaUrl: string;
};

const g = globalThis as {
  __fx_desktop_latest_cache?: Map<string, { exp: number; payload: DesktopPayload }>;
  __fx_desktop_latest_inflight?: Map<string, Promise<DesktopPayload>>;
};
if (!g.__fx_desktop_latest_cache) g.__fx_desktop_latest_cache = new Map();
if (!g.__fx_desktop_latest_inflight) g.__fx_desktop_latest_inflight = new Map();
const desktopLatestCache = g.__fx_desktop_latest_cache;
const desktopLatestInflight = g.__fx_desktop_latest_inflight;

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
  const raw = String(value || "").trim();
  return raw || "";
}

function packagePayloadFromMeta(meta: any, platform: "windows" | "mac") {
  const aliasKeys = platform === "windows" ? ["windows"] : ["mac", "macos", "apple"];
  const candidate = aliasKeys
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

function sweepDesktopCache(now: number) {
  if (!desktopLatestCache.size) return;
  for (const [key, entry] of desktopLatestCache.entries()) {
    if (entry.exp <= now) desktopLatestCache.delete(key);
  }
}

async function loadDesktopPayload() {
  const prefix = desktopPrefix.replace(/\/+$/, "");
  const metaKey = `${prefix}/desktop-package.json`;
  const exeKey = `${prefix}/fxlocus_setup.exe`;
  const macKey = `${prefix}/fxlocus_macos.dmg`;
  const metaUrl = buildPublicUrl(metaKey);
  const metaRes = metaUrl ? await fetch(metaUrl, { cache: "no-store" }) : null;
  const meta = metaRes && metaRes.ok ? await metaRes.json().catch(() => null) : null;

  const version = String(meta?.version || "");
  const builtAt = String(meta?.builtAt || "") || null;
  const windowsFromMeta = packagePayloadFromMeta(meta, "windows");
  const macFromMeta = packagePayloadFromMeta(meta, "mac");
  const hasMacDmgInR2 = await r2ObjectExists(macKey);
  const hasWindowsInR2 = await r2ObjectExists(exeKey);
  const macFallbackKey = hasMacDmgInR2 ? macKey : "";
  const windowsUrl = normalizeUrl(
    windowsFromMeta?.url || meta?.downloadUrl || (hasWindowsInR2 ? buildPublicUrl(exeKey) : "")
  );
  const macUrl = normalizeUrl(
    macFromMeta?.url || (macFallbackKey ? buildPublicUrl(macFallbackKey) : "")
  );
  return {
    version,
    builtAt,
    downloadUrl: windowsUrl,
    packages: {
      windows: {
        url: windowsUrl,
        fileName: windowsFromMeta?.fileName || "fxlocus_setup.exe",
        sizeBytes: windowsFromMeta?.sizeBytes || null
      },
      mac: {
        url: macUrl,
        fileName: macFromMeta?.fileName || "fxlocus_macos.dmg",
        sizeBytes: macFromMeta?.sizeBytes || null
      }
    },
    metaUrl
  };
}

export async function GET(req: NextRequest) {
  const wantsJson = req.nextUrl.searchParams.get("json") === "1";
  const platformRaw = String(req.nextUrl.searchParams.get("platform") || "windows").toLowerCase();
  const platform = ["mac", "macos", "apple"].includes(platformRaw) ? "mac" : "windows";
  const prefix = desktopPrefix.replace(/\/+$/, "");
  const exeKey = `${prefix}/fxlocus_setup.exe`;
  const macKey = `${prefix}/fxlocus_macos.dmg`;
  try {
    const now = Date.now();
    sweepDesktopCache(now);
    const cached = desktopLatestCache.get(CACHE_KEY);
    let payload: DesktopPayload | null = cached && cached.exp > now ? cached.payload : null;
    if (!payload) {
      let task = desktopLatestInflight.get(CACHE_KEY);
      if (!task) {
        task = loadDesktopPayload();
        desktopLatestInflight.set(CACHE_KEY, task);
      }
      const loaded = await task.finally(() => desktopLatestInflight.delete(CACHE_KEY));
      payload = loaded;
      desktopLatestCache.set(CACHE_KEY, { exp: Date.now() + CACHE_TTL_MS, payload: loaded });
    }
    if (!payload) throw new Error("PAYLOAD_EMPTY");

    if (wantsJson) {
      return json({
        ok: true,
        version: payload.version,
        builtAt: payload.builtAt,
        downloadUrl: payload.downloadUrl,
        packages: payload.packages,
        metaUrl: payload.metaUrl
      });
    }

    if (platform === "mac") {
      if (payload.packages.mac.url) {
        const res = NextResponse.redirect(payload.packages.mac.url, 302);
        res.headers.set("Cache-Control", "private, max-age=60");
        return res;
      }
      if (r2Enabled()) {
        if (await r2ObjectExists(macKey)) {
          const signed = await r2PresignGet(macKey, 3600);
          const res = NextResponse.redirect(signed, 302);
          res.headers.set("Cache-Control", "private, max-age=60");
          return res;
        }
      }
      return new NextResponse("macOS package not uploaded yet.", {
        status: 404,
        headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" }
      });
    }

    if (payload.packages.windows.url) {
      const res = NextResponse.redirect(payload.packages.windows.url, 302);
      res.headers.set("Cache-Control", "private, max-age=60");
      return res;
    }

    if (r2Enabled()) {
      if (await r2ObjectExists(exeKey)) {
        const signed = await r2PresignGet(exeKey, 3600);
        const res = NextResponse.redirect(signed, 302);
        res.headers.set("Cache-Control", "private, max-age=60");
        return res;
      }
    }
    return json({ ok: false, error: "NO_INSTALLER" }, 404);
  } catch (e: any) {
    return json({ ok: false, error: e?.message || "FETCH_FAILED" }, 500);
  }
}
