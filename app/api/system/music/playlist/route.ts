import { NextResponse } from "next/server";

import { SYSTEM_MUSIC_FILES } from "@/lib/system/musicPlaylist";
import { r2Enabled, r2ListKeys } from "@/lib/storage/r2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const CACHE_TTL_MS = 3 * 60 * 1000;
const CACHE_KEY = "playlist";
const g = globalThis as {
  __fx_music_playlist_cache?: Map<string, { exp: number; payload: { ok: true; items: any[] } }>;
  __fx_music_playlist_inflight?: Map<string, Promise<{ ok: true; items: any[] }>>;
};
if (!g.__fx_music_playlist_cache) g.__fx_music_playlist_cache = new Map();
if (!g.__fx_music_playlist_inflight) g.__fx_music_playlist_inflight = new Map();
const playlistCache = g.__fx_music_playlist_cache;
const playlistInflight = g.__fx_music_playlist_inflight;
const MUSIC_TRACK_PREFIX = "music/tracks/";
const LEGACY_MUSIC_PREFIX = "music/";

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: {
      "Cache-Control":
        status >= 400 ? "no-store" : "private, max-age=60, stale-while-revalidate=300"
    }
  });
}

function encodeFileName(fileName: string) {
  return fileName
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function buildStreamPath(fileName: string) {
  return `/api/system/music/stream?file=${encodeFileName(fileName)}`;
}

function normalizeCdnBase(value: string) {
  const base = String(value || "").trim();
  if (!base) return "";
  return `${base.replace(/\/+$/, "")}/${MUSIC_TRACK_PREFIX.replace(/\/+$/, "")}`;
}

const LEGACY_TRACK_PATTERN = /^1\s*\((\d+)\)(\.[^.]+)$/i;

function normalizeTrackFileName(fileName: string) {
  const raw = String(fileName || "").trim();
  if (!raw) return raw;
  const match = raw.match(LEGACY_TRACK_PATTERN);
  if (match) return `music (${match[1]})${match[2]}`;
  return raw;
}

function isAudioFile(fileName: string) {
  return /\.(mp3|wav|ogg|m4a|aac)$/i.test(String(fileName || ""));
}

function sortTrackNames(files: string[]) {
  return [...files].sort((a, b) => a.localeCompare(b, "en", { numeric: true, sensitivity: "base" }));
}

function stripMusicPrefix(key: string) {
  const raw = String(key || "").trim();
  if (!raw) return "";
  if (raw.startsWith(MUSIC_TRACK_PREFIX)) return raw.slice(MUSIC_TRACK_PREFIX.length).trim();
  if (raw.startsWith(LEGACY_MUSIC_PREFIX)) return raw.slice(LEGACY_MUSIC_PREFIX.length).trim();
  return raw;
}

function sweepPlaylistCache(now: number) {
  if (!playlistCache.size) return;
  for (const [key, entry] of playlistCache.entries()) {
    if (entry.exp <= now) playlistCache.delete(key);
  }
}

async function buildPlaylistPayload() {
  let files: string[] = [];
  if (r2Enabled()) {
    try {
      const keys = await r2ListKeys(MUSIC_TRACK_PREFIX, 10000);
      files = sortTrackNames(
        keys
          .map((key) => stripMusicPrefix(key))
          .filter(Boolean)
          .filter(isAudioFile)
      );
      if (!files.length) {
        const legacyKeys = await r2ListKeys(LEGACY_MUSIC_PREFIX, 10000);
        files = sortTrackNames(
          legacyKeys
            .map((key) => stripMusicPrefix(key))
            .filter(Boolean)
            .filter((key) => !key.startsWith("tracks/"))
            .filter(isAudioFile)
        );
      }
    } catch (error) {
      console.error("[music/playlist] list R2 keys failed", error);
    }
  }

  if (!files.length) {
    files = sortTrackNames(
      SYSTEM_MUSIC_FILES.map((item) => String(item || "").trim()).filter(Boolean)
    );
  }

  if (!files.length) {
    throw new Error("EMPTY_PLAYLIST");
  }

  const cdnBase = normalizeCdnBase(
    process.env.NEXT_PUBLIC_R2_CDN_BASE_URL ||
      process.env.R2_CDN_BASE_URL ||
      process.env.R2_PUBLIC_BASE_URL ||
      ""
  );

  const items = files.map((rawFileName, index) => {
    const sourceFileName = String(rawFileName || "").trim();
    const fileName = normalizeTrackFileName(sourceFileName);
    const encoded = encodeFileName(sourceFileName);
    const streamPath = buildStreamPath(sourceFileName);
    const cdnPath = cdnBase ? `${cdnBase}/${encoded}` : streamPath;
    return {
      id: `track-${index + 1}`,
      order: index + 1,
      fileName,
      title: fileName.replace(/\.[^.]+$/, ""),
      url: streamPath,
      fallbackUrl: cdnPath && cdnPath !== streamPath ? cdnPath : undefined
    };
  });
  return { ok: true as const, items };
}

export async function GET() {
  try {
    const now = Date.now();
    sweepPlaylistCache(now);
    const cached = playlistCache.get(CACHE_KEY);
    if (cached && cached.exp > now) {
      return json(cached.payload);
    }

    let task = playlistInflight.get(CACHE_KEY);
    if (!task) {
      task = buildPlaylistPayload();
      playlistInflight.set(CACHE_KEY, task);
    }
    const payload = await task.finally(() => playlistInflight.delete(CACHE_KEY));
    playlistCache.set(CACHE_KEY, { exp: Date.now() + CACHE_TTL_MS, payload });
    return json(payload);
  } catch (error: any) {
    return json({ ok: false, error: String(error?.message || "EMPTY_PLAYLIST") }, 500);
  }
}
