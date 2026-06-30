"use client";

import React from "react";
import { SYSTEM_MUSIC_FILES } from "@/lib/system/musicPlaylist";
import { fetchSystemJson } from "@/lib/system/clientFetch";

type PlaylistTrack = {
  id: string;
  order: number;
  title: string;
  fileName: string;
  url: string;
  fallbackUrl?: string;
};

type SavedState = {
  index: number;
  time: number;
  initialized: boolean;
};

type FxMusicRuntime = {
  audio: HTMLAudioElement;
  tracks: PlaylistTrack[];
  tracksPromise: Promise<PlaylistTrack[]> | null;
};

const MUSIC_STATE_KEY = "fxlocus_music_state_v2";
const MUSIC_VOLUME_KEY = "fxlocus_music_volume_v2";
const DEFAULT_VOLUME = 0.75;
const LEGACY_TRACK_PATTERN = /^1\s*\((\d+)\)(\.[^.]+)$/i;

function normalizeTrackFileName(fileName: string) {
  const raw = String(fileName || "").trim();
  if (!raw) return raw;
  const match = raw.match(LEGACY_TRACK_PATTERN);
  if (match) return `music (${match[1]})${match[2]}`;
  return raw;
}

function encodeTrackFile(fileName: string) {
  return String(fileName || "")
    .trim()
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function resolveTrackUrl(fileName: string) {
  const encoded = encodeTrackFile(fileName);
  return `/api/system/music/stream?file=${encoded}`;
}

function resolveTrackFallbackUrl(fileName: string) {
  const encoded = encodeTrackFile(fileName);
  const cdnBase = String((process.env.NEXT_PUBLIC_R2_CDN_BASE_URL || "").trim()).replace(/\/+$/, "");
  if (!cdnBase) return "";
  return `${cdnBase}/music/${encoded}`;
}

function buildFallbackTracks() {
  return SYSTEM_MUSIC_FILES.map((fileName, index) => {
    const sourceFileName = String(fileName || "").trim();
    const normalizedFileName = normalizeTrackFileName(sourceFileName);
    const streamPath = `/api/system/music/stream?file=${encodeTrackFile(sourceFileName)}`;
    const fallbackPath = resolveTrackFallbackUrl(sourceFileName);
    return {
      id: `track-fallback-${index + 1}`,
      order: index + 1,
      fileName: normalizedFileName,
      title: String(normalizedFileName).replace(/\.[^.]+$/, ""),
      url: streamPath,
      fallbackUrl: fallbackPath || undefined
    } as PlaylistTrack;
  });
}

declare global {
  interface Window {
    __fxMusicToggle?: () => void;
    __fxMusicPrev?: () => void;
    __fxMusicNext?: () => void;
    __fxMusicStop?: () => void;
    __fxMusicRuntime?: FxMusicRuntime;
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

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
    // ignore
  }
}

function readSavedState(): SavedState {
  const raw = safeStorageGet(MUSIC_STATE_KEY);
  if (!raw) return { index: 0, time: 0, initialized: false };
  try {
    const parsed = JSON.parse(raw);
    const index = Number(parsed?.index);
    const time = Number(parsed?.time);
    const initialized = Boolean(parsed?.initialized);
    return {
      index: Number.isFinite(index) && index >= 0 ? index : 0,
      time: Number.isFinite(time) && time >= 0 ? time : 0,
      initialized
    };
  } catch {
    return { index: 0, time: 0, initialized: false };
  }
}

function pickRandomIndex(total: number, excludeIndex = -1) {
  if (total <= 0) return 0;
  if (total === 1) return 0;
  let next = Math.floor(Math.random() * total);
  if (next === excludeIndex) {
    next = (next + 1 + Math.floor(Math.random() * (total - 1))) % total;
  }
  return next;
}

function emitMusicState(playing: boolean, index: number, total: number) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("fxmusic:state", {
      detail: { playing, index, total }
    })
  );
}

function getMusicRuntime(): FxMusicRuntime | null {
  if (typeof window === "undefined") return null;
  if (window.__fxMusicRuntime) return window.__fxMusicRuntime;

  const audio = new Audio();
  audio.preload = "auto";
  const savedVolume = Number(safeStorageGet(MUSIC_VOLUME_KEY));
  audio.volume = Number.isFinite(savedVolume) && savedVolume > 0 ? clamp(savedVolume, 0, 1) : DEFAULT_VOLUME;
  audio.muted = false;

  const runtime: FxMusicRuntime = {
    audio,
    tracks: [],
    tracksPromise: null
  };
  window.__fxMusicRuntime = runtime;
  return runtime;
}

export function FloatingMusicPlayer({ locale: _locale }: { locale: "zh" | "en" }) {
  const [playing, setPlaying] = React.useState(false);
  const [tracks, setTracks] = React.useState<PlaylistTrack[]>([]);
  const [currentIndex, setCurrentIndex] = React.useState(0);

  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  const runtimeRef = React.useRef<FxMusicRuntime | null>(null);
  const tracksRef = React.useRef<PlaylistTrack[]>([]);
  const indexRef = React.useRef(0);
  const pendingSeekRef = React.useRef(0);
  const usingFallbackRef = React.useRef(false);
  const saveTickRef = React.useRef(0);
  const playingRef = React.useRef(false);
  const brokenTrackIdsRef = React.useRef<Set<string>>(new Set());
  const streamErrorStreakRef = React.useRef(0);
  const retryTimerRef = React.useRef<number | null>(null);

  const pickPlayableRandomIndex = React.useCallback((excludeIndex: number) => {
    const list = tracksRef.current;
    if (!list.length) return 0;

    const broken = brokenTrackIdsRef.current;
    const candidates = list
      .map((_, idx) => idx)
      .filter((idx) => idx !== excludeIndex && !broken.has(String(list[idx]?.id || "")));

    if (candidates.length) {
      const picked = candidates[Math.floor(Math.random() * candidates.length)];
      return Number.isFinite(picked) ? picked : pickRandomIndex(list.length, excludeIndex);
    }
    return pickRandomIndex(list.length, excludeIndex);
  }, []);

  const saveState = React.useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    safeStorageSet(
      MUSIC_STATE_KEY,
      JSON.stringify({
        index: indexRef.current,
        time: Number.isFinite(audio.currentTime) && audio.currentTime > 0 ? audio.currentTime : 0,
        initialized: true
      })
    );
  }, []);

  const loadTracks = React.useCallback(async () => {
    const runtime = runtimeRef.current;
    if (!runtime) return [];

    if (runtime.tracks.length) return runtime.tracks;

    if (!runtime.tracksPromise) {
      runtime.tracksPromise = fetchSystemJson<{ ok?: boolean; items?: PlaylistTrack[] }>("/api/system/music/playlist", {
        dedupeKey: "music:playlist",
        dedupeWindowMs: 30_000,
        preferStale: true,
        revalidateInBackground: true,
        staleTtlMs: 10 * 60_000,
        allowStaleOnRateLimit: true,
        retries: 2,
        retryBaseMs: 260,
        retryMaxMs: 1200
      })
        .then((result) => {
          if (!result.ok) throw new Error(`playlist_${result.status || 0}`);
          return result.body as any;
        })
        .then((json) => {
          const items = Array.isArray(json?.items) ? (json.items as PlaylistTrack[]) : [];
          if (items.length) {
            runtime.tracks = items;
            return items;
          }
          const fallback = buildFallbackTracks();
          runtime.tracks = fallback;
          return fallback;
        })
        .catch(() => {
          const fallback = buildFallbackTracks();
          runtime.tracks = fallback;
          return fallback;
        })
        .finally(() => {
          runtime.tracksPromise = null;
        });
    }

    return runtime.tracksPromise;
  }, []);

  const playAudio = React.useCallback(() => {
    const audio = audioRef.current;
    const list = tracksRef.current;
    if (!audio || !list.length) return;
    const promise = audio.play();
    if (promise && typeof promise.catch === "function") {
      void promise.catch(() => {
        playingRef.current = false;
        setPlaying(false);
        emitMusicState(false, indexRef.current, list.length);
      });
    }
  }, []);

  const applyTrack = React.useCallback((nextIndex: number, seekSeconds = 0) => {
    const audio = audioRef.current;
    const list = tracksRef.current;
    if (!audio || !list.length) return;
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }

    const safeIndex = ((nextIndex % list.length) + list.length) % list.length;
    const track = list[safeIndex];
    if (!track) return;

    audio.pause();
    indexRef.current = safeIndex;
    setCurrentIndex(safeIndex);
    pendingSeekRef.current = Math.max(0, seekSeconds);
    usingFallbackRef.current = false;
    brokenTrackIdsRef.current.delete(String(track.id || ""));
    audio.src = track.url;
    audio.load();
  }, []);

  React.useEffect(() => {
    const runtime = getMusicRuntime();
    if (!runtime) return;

    runtimeRef.current = runtime;
    audioRef.current = runtime.audio;
    tracksRef.current = runtime.tracks;
    setTracks(runtime.tracks);

    const saved = readSavedState();
    indexRef.current = saved.index;
    setCurrentIndex(saved.index);
    setPlaying(!runtime.audio.paused);
    playingRef.current = !runtime.audio.paused;

    const audio = runtime.audio;

    const onPlay = () => {
      playingRef.current = true;
      streamErrorStreakRef.current = 0;
      setPlaying(true);
      emitMusicState(true, indexRef.current, tracksRef.current.length);
    };

    const onPause = () => {
      playingRef.current = false;
      setPlaying(false);
      saveState();
      emitMusicState(false, indexRef.current, tracksRef.current.length);
    };

    const onLoadedMetadata = () => {
      if (pendingSeekRef.current > 0 && Number.isFinite(audio.duration)) {
        audio.currentTime = clamp(pendingSeekRef.current, 0, Math.max(0, audio.duration - 0.25));
      }
      pendingSeekRef.current = 0;
      streamErrorStreakRef.current = 0;
    };

    const onEnded = () => {
      saveState();
      const list = tracksRef.current;
      const nextIndex = pickPlayableRandomIndex(indexRef.current);
      applyTrack(nextIndex, 0);
      playAudio();
    };

    const onTimeUpdate = () => {
      const now = Date.now();
      if (now - saveTickRef.current < 2000) return;
      saveTickRef.current = now;
      saveState();
    };

    const onError = () => {
      const list = tracksRef.current;
      const track = list[indexRef.current];
      if (!track) return;

      if (!usingFallbackRef.current && track.fallbackUrl && track.fallbackUrl !== track.url) {
        usingFallbackRef.current = true;
        audio.src = track.fallbackUrl;
        audio.load();
        if (playingRef.current) playAudio();
        return;
      }

      brokenTrackIdsRef.current.add(String(track.id || ""));
      streamErrorStreakRef.current += 1;
      const retryDelayMs = Math.min(8000, 500 * 2 ** Math.min(streamErrorStreakRef.current, 4));
      const shouldResume = playingRef.current;
      const allBroken = brokenTrackIdsRef.current.size >= list.length;

      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }

      if (allBroken || streamErrorStreakRef.current >= 6) {
        playingRef.current = false;
        setPlaying(false);
        emitMusicState(false, indexRef.current, list.length);
        saveState();
        retryTimerRef.current = window.setTimeout(() => {
          retryTimerRef.current = null;
          brokenTrackIdsRef.current.clear();
          streamErrorStreakRef.current = 0;
          if (!shouldResume) return;
          const nextIndex = pickPlayableRandomIndex(indexRef.current);
          applyTrack(nextIndex, 0);
          playAudio();
        }, 15_000);
        return;
      }

      retryTimerRef.current = window.setTimeout(() => {
        retryTimerRef.current = null;
        const nextIndex = pickPlayableRandomIndex(indexRef.current);
        applyTrack(nextIndex, 0);
        if (shouldResume) playAudio();
      }, retryDelayMs);
    };

    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("error", onError);

    const handleBeforeUnload = () => saveState();
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("error", onError);
      // Keep global playback running across route/menu transitions.
      // Explicit stop still goes through stopSystemMusic / fxmusic:command.
      saveState();
    };
  }, [applyTrack, pickPlayableRandomIndex, playAudio, saveState]);

  React.useEffect(() => {
    const runtime = runtimeRef.current;
    const loaded = runtime?.tracks || [];
    if (loaded.length) {
      tracksRef.current = loaded;
      brokenTrackIdsRef.current.clear();
      setTracks(loaded);
      const saved = readSavedState();
      const safeIndex = clamp(saved.index, 0, loaded.length - 1);
      indexRef.current = safeIndex;
      setCurrentIndex(safeIndex);
    }
  }, []);

  const togglePlayback = React.useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (!audio.paused) {
      audio.pause();
      return;
    }

    const startPlayback = () => {
      const list = tracksRef.current;
      if (!list.length) return;

      const saved = readSavedState();
      const randomStart = !saved.initialized;
      const safeIndex = randomStart
        ? pickPlayableRandomIndex(indexRef.current)
        : clamp(saved.index, 0, list.length - 1);
      const shouldSwitchTrack = !audio.src || safeIndex !== indexRef.current;
      const seekTarget = randomStart ? 0 : saved.time;

      if (shouldSwitchTrack) {
        applyTrack(safeIndex, seekTarget);
      } else if (Number.isFinite(saved.time) && saved.time > 0) {
        const currentTime = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
        if (Math.abs(currentTime - saved.time) > 1.5) {
          audio.currentTime = clamp(
            saved.time,
            0,
            Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : saved.time
          );
        }
      }

      playAudio();
    };

    if (!tracksRef.current.length) {
      void loadTracks().then((loaded) => {
        tracksRef.current = loaded;
        brokenTrackIdsRef.current.clear();
        setTracks(loaded);
        if (!loaded.length) return;
        startPlayback();
      });
      return;
    }

    startPlayback();
  }, [applyTrack, loadTracks, pickPlayableRandomIndex, playAudio]);

  const stopPlayback = React.useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!audio.paused) audio.pause();
    saveState();
    playingRef.current = false;
    setPlaying(false);
    emitMusicState(false, indexRef.current, tracksRef.current.length);
  }, [saveState]);

  const switchTrackRandom = React.useCallback(() => {
      const audio = audioRef.current;
      if (!audio) return;

      const resolveAndSwitch = () => {
        const list = tracksRef.current;
        if (!list.length) return;

        const current = clamp(indexRef.current, 0, list.length - 1);
        const nextIndex = pickPlayableRandomIndex(current);

        applyTrack(nextIndex, 0);
        playAudio();
        saveState();
      };

      if (!tracksRef.current.length) {
        void loadTracks().then((loaded) => {
          tracksRef.current = loaded;
          brokenTrackIdsRef.current.clear();
          setTracks(loaded);
          resolveAndSwitch();
        });
        return;
      }

      resolveAndSwitch();
  }, [applyTrack, loadTracks, pickPlayableRandomIndex, playAudio, saveState]);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const onCommand = (event: Event) => {
      const detail = (event as CustomEvent<{ type?: string }>).detail;
      const type = String(detail?.type || "").trim().toLowerCase();
      if (type === "toggle") {
        togglePlayback();
        return;
      }
      if (type === "stop") {
        stopPlayback();
        return;
      }
      if (type === "prev" || type === "next") {
        switchTrackRandom();
      }
    };
    window.addEventListener("fxmusic:command", onCommand as EventListener);
    return () => window.removeEventListener("fxmusic:command", onCommand as EventListener);
  }, [stopPlayback, switchTrackRandom, togglePlayback]);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    window.__fxMusicToggle = togglePlayback;
    window.__fxMusicPrev = switchTrackRandom;
    window.__fxMusicNext = switchTrackRandom;
    window.__fxMusicStop = stopPlayback;
    return () => {
      delete window.__fxMusicToggle;
      delete window.__fxMusicPrev;
      delete window.__fxMusicNext;
      delete window.__fxMusicStop;
    };
  }, [stopPlayback, switchTrackRandom, togglePlayback]);

  React.useEffect(() => {
    emitMusicState(playing, currentIndex, tracks.length);
  }, [currentIndex, playing, tracks.length]);

  return null;
}
