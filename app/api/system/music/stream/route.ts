import path from "node:path";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { NextRequest, NextResponse } from "next/server";

import { requireSystemUser } from "@/lib/system/guard";
import { r2Enabled, r2ObjectExists, r2PresignGet } from "@/lib/storage/r2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LEGACY_TRACK_PATTERN = /^1\s*\((\d+)\)(\.[^.]+)$/i;
const ALLOWED_EXTENSIONS = new Set([".mp3", ".wav", ".ogg", ".m4a", ".aac"]);
const STREAM_KEY_CACHE_TTL_MS = 10 * 60 * 1000;
const MUSIC_TRACK_PREFIX = "music/tracks/";
const LEGACY_MUSIC_PREFIX = "music/";

const resolvedTrackKeyCache = new Map<string, { key: string; expiresAt: number }>();

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "no-store" }
  });
}

function normalizeTrackFileName(fileName: string) {
  const raw = String(fileName || "").trim();
  if (!raw) return raw;
  const match = raw.match(LEGACY_TRACK_PATTERN);
  if (match) return `music (${match[1]})${match[2]}`;
  return raw;
}

function toLegacyTrackFileName(fileName: string) {
  const raw = String(fileName || "").trim();
  const match = raw.match(/^music\s*\((\d+)\)(\.[^.]+)$/i);
  if (!match) return raw;
  return `1 (${match[1]})${match[2]}`;
}

function parseTrackFiles(input: string) {
  let value = String(input || "").trim();
  try {
    value = decodeURIComponent(value);
  } catch {
    // keep raw value
  }
  value = value.replace(/\\/g, "/").replace(/^\/+/, "").trim();
  if (!value || value.includes("..") || value.includes("/")) return [] as string[];
  const ext = path.extname(value).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) return [] as string[];
  const normalized = normalizeTrackFileName(value);
  const legacy = toLegacyTrackFileName(normalized);
  const directLegacy = toLegacyTrackFileName(value);
  const candidates = [value, normalized, directLegacy, legacy]
    .map((item) => String(item || "").trim())
    .filter(Boolean);
  return Array.from(new Set(candidates));
}

function readCachedTrackKey(candidates: string[]) {
  const now = Date.now();
  for (const candidate of candidates) {
    const cached = resolvedTrackKeyCache.get(candidate);
    if (!cached) continue;
    if (cached.expiresAt <= now) {
      resolvedTrackKeyCache.delete(candidate);
      continue;
    }
    return cached.key;
  }
  return "";
}

function writeCachedTrackKey(candidates: string[], key: string) {
  const expiresAt = Date.now() + STREAM_KEY_CACHE_TTL_MS;
  for (const candidate of candidates) {
    resolvedTrackKeyCache.set(candidate, { key, expiresAt });
  }
}

function buildTrackKeyCandidates(fileName: string) {
  const normalized = String(fileName || "").trim();
  if (!normalized) return [] as string[];
  return [`${MUSIC_TRACK_PREFIX}${normalized}`, `${LEGACY_MUSIC_PREFIX}${normalized}`];
}

function contentTypeByExt(fileName: string) {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === ".mp3") return "audio/mpeg";
  if (ext === ".wav") return "audio/wav";
  if (ext === ".ogg") return "audio/ogg";
  if (ext === ".m4a") return "audio/mp4";
  if (ext === ".aac") return "audio/aac";
  return "application/octet-stream";
}

export async function GET(req: NextRequest) {
  try {
    await requireSystemUser();

    const rawFile = String(req.nextUrl.searchParams.get("file") || "").trim();
    const fileNames = parseTrackFiles(rawFile);
    if (!fileNames.length) return json({ ok: false, error: "INVALID_FILE" }, 400);

    if (r2Enabled()) {
      try {
        const cached = readCachedTrackKey(fileNames);
        if (cached) {
          const signedUrl = await r2PresignGet(cached, 600);
          const res = NextResponse.redirect(signedUrl, 302);
          res.headers.set("Cache-Control", "private, max-age=300");
          return res;
        }

        for (const fileName of fileNames) {
          for (const key of buildTrackKeyCandidates(fileName)) {
            const exists = await r2ObjectExists(key);
            if (!exists) continue;
            writeCachedTrackKey(fileNames, key);
            const signedUrl = await r2PresignGet(key, 600);
            const res = NextResponse.redirect(signedUrl, 302);
            res.headers.set("Cache-Control", "private, max-age=300");
            return res;
          }
        }
      } catch {
        // fallback to local file in development
      }
    }

    const localCandidates = [
      ...fileNames.map((fileName) => path.join(process.cwd(), "music", fileName)),
      ...fileNames.map((fileName) => path.join(process.cwd(), "public", "music", fileName))
    ];
    const localPath = localCandidates.find((candidate) => existsSync(candidate));
    if (!localPath) return json({ ok: false, error: "NOT_FOUND" }, 404);
    const buffer = await readFile(localPath);
    const resolvedName = path.basename(localPath);
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": contentTypeByExt(resolvedName),
        "Cache-Control": "public, max-age=3600"
      }
    });
  } catch (e: any) {
    const code = String(e?.code || "UNAUTHORIZED");
    const status = code === "FORBIDDEN" ? 403 : code === "FROZEN" ? 403 : 401;
    return json({ ok: false, error: code }, status);
  }
}
