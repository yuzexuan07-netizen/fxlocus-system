"use client";

import React from "react";
import {
  ArrowLeft,
  Bell,
  BellOff,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  ImageUp,
  Keyboard,
  Mic,
  MicOff,
  Pause,
  Phone,
  Play,
  Send,
  Smile,
  Volume2,
  VolumeX
} from "lucide-react";

import { PreviewModal } from "@/components/system/PreviewModal";
import { createClientRequestId } from "@/lib/system/clientRequestId";
import { dispatchSidebarDelta, dispatchSystemRealtime } from "@/lib/system/realtime";
import { fetchSystemJson } from "@/lib/system/clientFetch";
import { acquireGlobalPollSlot } from "@/lib/system/clientPolling";
import { setMobilePrimaryTabHref } from "@/lib/system/mobilePrimaryTabs";
import { useSystemRealtimeRefresh } from "@/lib/system/useSystemRealtimeRefresh";
import { useProgressiveList } from "@/lib/hooks/useProgressiveList";
import { repairMojibake } from "@/lib/text/repairMojibake";

type Recipient = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone?: string | null;
  role: string | null;
  avatar_url: string | null;
  last_message_at?: string | null;
  support_name?: string | null;
  assistant_name?: string | null;
  coach_name?: string | null;
};

type Message = {
  id: string;
  from_user_id: string;
  to_user_id: string;
  content_type: string;
  content_text: string | null;
  image_url: string | null;
  image_name: string | null;
  image_mime_type: string | null;
  image_size_bytes: number | null;
  reply_to_message_id?: string | null;
  reply_to?: {
    id: string;
    from_user_id: string;
    to_user_id: string;
    content_type: string;
    content_text: string | null;
    image_name?: string | null;
    created_at: string;
  } | null;
  created_at: string;
  read_at?: string | null;
  pending?: boolean;
  audio_duration_sec?: number | null;
};

type CallSession = {
  id: string;
  caller_user_id: string;
  callee_user_id: string;
  status: string;
  created_at: string;
  updated_at: string;
  answered_at: string | null;
  ended_at: string | null;
};

type CallSignal = {
  id: number;
  session_id: string;
  from_user_id: string;
  to_user_id: string;
  kind: string;
  payload: string | null;
  created_at: string;
};

function buildCallIceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [
    { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }
  ];
  const turnUrls = String(process.env.NEXT_PUBLIC_WEBRTC_TURN_URLS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (turnUrls.length > 0) {
    servers.push({
      urls: turnUrls,
      username: process.env.NEXT_PUBLIC_WEBRTC_TURN_USERNAME || undefined,
      credential: process.env.NEXT_PUBLIC_WEBRTC_TURN_CREDENTIAL || undefined
    });
  } else {
    servers.push({
      urls: [
        "turn:openrelay.metered.ca:80",
        "turn:openrelay.metered.ca:443",
        "turn:openrelay.metered.ca:443?transport=tcp"
      ],
      username: "openrelayproject",
      credential: "openrelayproject"
    });
  }
  return servers;
}

const EMOJIS = [
  "😀",
  "😃",
  "😄",
  "😁",
  "😆",
  "😅",
  "😂",
  "🤣",
  "😊",
  "😇",
  "🙂",
  "🙃",
  "😉",
  "😌",
  "😍",
  "🥰",
  "😘",
  "😗",
  "😙",
  "😚",
  "😋",
  "😛",
  "😝",
  "😜",
  "🤪",
  "🤨",
  "🧐",
  "🤓",
  "😎",
  "🥳",
  "😏",
  "😒",
  "😞",
  "😔",
  "😟",
  "😕",
  "🙁",
  "☹️",
  "😣",
  "😖",
  "😫",
  "😩",
  "🥺",
  "😢",
  "😭",
  "😤",
  "😠",
  "😡",
  "🤬",
  "🤯",
  "😳",
  "🥵",
  "🥶",
  "😱",
  "😨",
  "😰",
  "😥",
  "😓",
  "🤗",
  "🤔",
  "🤭",
  "🤫",
  "🤥",
  "😶",
  "😐",
  "😑",
  "🙄",
  "😬",
  "🥴",
  "🤐",
  "🤢",
  "🤮",
  "🤧",
  "😷",
  "🤒",
  "🤕",
  "🤑",
  "🤠",
  "😈",
  "👿",
  "👹",
  "👺",
  "💀",
  "👻",
  "👽",
  "🤖",
  "💩",
  "😺",
  "😸",
  "😹",
  "😻",
  "😼",
  "😽",
  "🙀",
  "😿",
  "😾",
  "👋",
  "🤚",
  "✋",
  "🖐️",
  "🖖",
  "👌",
  "🤏",
  "✌️",
  "🤞",
  "🤟",
  "🤘",
  "🤙",
  "👈",
  "👉",
  "👆",
  "🖕",
  "👇",
  "☝️",
  "👍",
  "👎",
  "✊",
  "👊",
  "🤛",
  "🤜",
  "👏",
  "🙌",
  "👐",
  "🤲",
  "🤝",
  "🙏",
  "💪",
  "🦾",
  "🫶",
  "🫵",
  "🫰",
  "✍️",
  "🤳",
  "👂",
  "👃",
  "👀",
  "🧠",
  "🦴",
  "🦷",
  "👄",
  "💋",
  "🐱",
  "🐈",
  "🐈‍⬛",
  "🐾",
  "🧶",
  "🐶",
  "🐕",
  "🐕‍🦺",
  "🐩",
  "🦊",
  "🐻",
  "🐻‍❄️",
  "🐼",
  "🐨",
  "🐯",
  "🦁",
  "🐮",
  "🐷",
  "🐵",
  "🙈",
  "🙉",
  "🙊",
  "🐸",
  "🐔",
  "🐧",
  "🐦",
  "🐤",
  "🦆",
  "🦅",
  "🦉",
  "🐟",
  "🐬",
  "🐳",
  "🐢",
  "🦋",
  "🐞",
  "🐝",
  "🪲",
  "🪳",
  "🍎",
  "🍊",
  "🍋",
  "🍓",
  "🍇",
  "🍒",
  "🍉",
  "🍌",
  "🍔",
  "🍟",
  "🍕",
  "🌮",
  "🍣",
  "🍩",
  "🍪",
  "☕",
  "🧋",
  "🎉",
  "✨",
  "💡"
];

const RECENT_EMOJI_KEY = "fxlocus_consult_emoji_recent";
const EMOJI_PAGE_SIZE = 32;
const RECENT_LIMIT = 24;
const DEFAULT_RECENTS = EMOJIS.slice(0, 20);
const ALERT_SETTINGS_KEY = "fxlocus_consult_alert_settings_v1";

type ToneStep = { freq: number; duration: number; gain?: number };
const ALERT_TONE_STEPS: ToneStep[] = [
  { freq: 1046, duration: 0.08, gain: 0.16 },
  { freq: 1318, duration: 0.08, gain: 0.15 },
  { freq: 1568, duration: 0.14, gain: 0.18 }
];
const MESSAGE_CACHE_MAX_ITEMS = 160;
const MESSAGE_CACHE_TTL_MS = 45 * 60_000;
const VOICE_RECORD_MAX_MS = 120_000;
const VOICE_RECORD_COUNTDOWN_MS = 10_000;

type EmojiTab = "recent" | "all";
export type ConsultClientProps = {
  locale: "zh" | "en";
  initialMeId?: string;
  initialRecipients?: Recipient[];
  initialUnreadByPeer?: Record<string, number>;
  initialLatestByPeer?: Record<string, string>;
  forceMobileApp?: boolean;
};

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

function safeSessionStorageGet(key: string) {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSessionStorageSet(key: string, value: string) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

function waitForMs(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function getCapacitorPlugin<T = any>(name: string): T | null {
  if (typeof window === "undefined") return null;
  const capacitor = (window as any).Capacitor;
  return (capacitor?.Plugins?.[name] || null) as T | null;
}

function buildAudioConstraints(): MediaStreamConstraints {
  return {
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    }
  };
}

function normalizeEmojiList(list: string[]) {
  const seen = new Set<string>();
  const output: string[] = [];
  list.forEach((emoji) => {
    if (!EMOJIS.includes(emoji)) return;
    if (seen.has(emoji)) return;
    seen.add(emoji);
    output.push(emoji);
  });
  return output;
}

function formatTime(value: string, locale: "zh" | "en") {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(locale === "zh" ? "zh-CN" : "en-US", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function roleLabel(role: string | null, locale: "zh" | "en") {
  const key = String(role || "");
  if (locale === "zh") {
    if (key === "student") return "学员";
    if (key === "trader") return "数据采集员";
    if (key === "coach") return "教练";
    if (key === "assistant") return "助教";
    if (key === "leader") return "团队长";
    if (key === "super_admin") return "超管";
    return "其他";
  }
  if (key === "student") return "Student";
  if (key === "trader") return "Data Collector";
  if (key === "coach") return "Coach";
  if (key === "assistant") return "Assistant";
  if (key === "leader") return "Leader";
  if (key === "super_admin") return "Super admin";
  return "Other";
}

function resolveSupportDisplayName(item: {
  support_name?: string | null;
  assistant_name?: string | null;
  coach_name?: string | null;
}) {
  return String(item.coach_name || item.assistant_name || item.support_name || "").trim();
}

function supportSuffix(
  item: { support_name?: string | null; assistant_name?: string | null; coach_name?: string | null; role?: string | null },
  locale: "zh" | "en"
) {
  const support = resolveSupportDisplayName(item);
  if (support) return `（${support}）`;
  const role = String(item.role || "").trim();
  if (role === "student" || role === "trader") {
    return locale === "zh" ? "（未分配）" : "(Unassigned)";
  }
  return "";
}

function isEmojiOnly(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return false;
  const hasEmoji = /[\p{Extended_Pictographic}]/u.test(trimmed);
  if (!hasEmoji) return false;
  return /^[\p{Extended_Pictographic}\p{Emoji_Presentation}\p{Emoji}\u200d\uFE0F\s]+$/u.test(
    trimmed
  );
}

function quotePreviewText(
  message:
    | Message
    | {
        content_type?: string | null;
        content_text?: string | null;
        image_name?: string | null;
      }
    | null
    | undefined,
  locale: "zh" | "en"
) {
  if (!message) return "";
  const text = String(message.content_text || "").trim();
  if (text) return text.slice(0, 120);
  const contentType = String(message.content_type || "").toLowerCase();
  const imageName = String(message.image_name || "").trim();
  if (contentType === "image" || contentType === "mixed" || imageName) {
    return imageName || (locale === "zh" ? "[图片]" : "[Image]");
  }
  return locale === "zh" ? "[消息]" : "[Message]";
}

function parseTimeToNumber(value: string | null | undefined) {
  const raw = String(value || "").trim();
  if (!raw) return 0;

  if (/^-?\d+(?:\.\d+)?$/.test(raw)) {
    const numeric = Number(raw);
    if (Number.isFinite(numeric)) {
      if (numeric > 1e12) return Math.floor(numeric);
      if (numeric > 1e9) return Math.floor(numeric * 1000);
    }
  }

  const direct = Date.parse(raw);
  if (Number.isFinite(direct)) return direct;

  const sqliteLike = raw.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/);
  if (sqliteLike) {
    const normalized = `${sqliteLike[1]}T${sqliteLike[2]}Z`;
    const ts = Date.parse(normalized);
    if (Number.isFinite(ts)) return ts;
  }

  if (/^\d{4}-\d{2}-\d{2}T/.test(raw) && !/[zZ]|[+\-]\d{2}:?\d{2}$/.test(raw)) {
    const ts = Date.parse(`${raw}Z`);
    if (Number.isFinite(ts)) return ts;
  }

  const slashLike = raw.match(/^(\d{4})\/(\d{2})\/(\d{2})[ T](\d{2}:\d{2}:\d{2})$/);
  if (slashLike) {
    const normalized = `${slashLike[1]}-${slashLike[2]}-${slashLike[3]}T${slashLike[4]}Z`;
    const ts = Date.parse(normalized);
    if (Number.isFinite(ts)) return ts;
  }

  return 0;
}

function stripQueryParam(url: string, key: string) {
  const raw = String(url || "").trim();
  if (!raw) return raw;
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return raw
    .replace(new RegExp(`([?&])${escapedKey}=[^&]*`, "gi"), "$1")
    .replace(/[?&]$/, "");
}

function withDisposition(url: string, disposition: "inline" | "attachment") {
  const raw = String(url || "").trim();
  if (!raw) return raw;
  const modeStripped = stripQueryParam(raw, "mode");
  const separator = modeStripped.includes("?") ? "&" : "?";
  if (/[?&]disposition=/i.test(modeStripped)) {
    return modeStripped.replace(/([?&]disposition=)[^&]*/i, `$1${disposition}`);
  }
  return `${modeStripped}${separator}disposition=${disposition}`;
}

function withModeProxy(url: string) {
  const raw = String(url || "").trim();
  if (!raw) return raw;
  const normalized = stripQueryParam(raw, "mode");
  const separator = normalized.includes("?") ? "&" : "?";
  return `${normalized}${separator}mode=proxy`;
}

function canResolveImageProxy(url: string | null | undefined) {
  const raw = String(url || "").trim();
  if (!raw) return false;
  if (raw.startsWith("/api/system/")) return true;
  try {
    const parsed = raw.startsWith("/") ? new URL(raw, "https://fxlocus.local") : new URL(raw);
    return parsed.pathname.startsWith("/api/system/");
  } catch {
    return false;
  }
}

function buildImagePreviewCandidates(url: string | null | undefined) {
  const raw = String(url || "").trim();
  if (!raw) return [] as string[];
  const candidates = [raw];
  if (canResolveImageProxy(raw)) {
    candidates.unshift(withModeProxy(withDisposition(raw, "inline")));
  }
  return Array.from(new Set(candidates.filter(Boolean)));
}

function buildAudioPlaybackCandidates(url: string | null | undefined) {
  const raw = String(url || "").trim();
  if (!raw) return [] as string[];
  const candidates = [raw];
  if (canResolveImageProxy(raw)) {
    candidates.unshift(withModeProxy(withDisposition(raw, "inline")));
  }
  return Array.from(new Set(candidates.filter(Boolean)));
}

function pickSupportedRecorderMime() {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") {
    return "";
  }
  const candidates = [
    "audio/mp4",
    "audio/aac",
    "audio/x-m4a",
    "audio/m4a",
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/ogg"
  ];
  return candidates.find((item) => MediaRecorder.isTypeSupported(item)) || "";
}

function localizeConsultError(code: string, locale: "zh" | "en") {
  const normalized = String(code || "").trim().toUpperCase();
  if (normalized === "FETCH_FAILED" || normalized === "LOAD_FAILED") {
    return locale === "zh" ? "消息加载失败，请稍后重试" : "Failed to load messages. Please retry.";
  }
  if (normalized === "SEND_FAILED") {
    return locale === "zh" ? "发送失败，请稍后重试" : "Failed to send message.";
  }
  if (normalized === "UPLOAD_FAILED" || normalized === "DB_INSERT_FAILED") {
    return locale === "zh" ? "语音发送失败，请稍后重试" : "Voice message failed to send. Please retry.";
  }
  if (normalized === "MICROPHONE_PERMISSION_DENIED") {
    return locale === "zh" ? "麦克风权限被拒绝" : "Microphone permission denied.";
  }
  if (normalized === "MICROPHONE_IN_USE") {
    return locale === "zh" ? "麦克风当前被其他应用占用，请稍后重试" : "Microphone is being used by another app.";
  }
  if (normalized === "CALL_START_FAILED") {
    return locale === "zh" ? "语音通话启动失败" : "Failed to start voice call.";
  }
  if (normalized === "CALL_ACCEPT_FAILED") {
    return locale === "zh" ? "接听失败" : "Failed to answer call.";
  }
  if (normalized === "CALL_MISSED") {
    return locale === "zh" ? "对方暂时未接通" : "The other side did not answer.";
  }
  if (normalized === "CALL_REJECTED") {
    return locale === "zh" ? "对方已拒接" : "The call was declined.";
  }
  return code;
}

function formatAudioDuration(durationSec: number, locale: "zh" | "en") {
  const totalSeconds = Math.max(0, Math.round(normalizeAudioDurationValue(durationSec) || 0));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function normalizeAudioDurationValue(durationSec: number, fallback = 0) {
  const normalized = Math.max(0, Number(durationSec || 0));
  if (!Number.isFinite(normalized) || normalized <= 0) return Math.max(0, Number(fallback || 0));
  if (normalized > 3 * 60) return Math.max(0, Number(fallback || 0));
  return normalized;
}

function parseWavDuration(buffer: ArrayBuffer) {
  if (buffer.byteLength < 44) return 0;
  const view = new DataView(buffer);
  const text = (offset: number, length: number) => {
    let value = "";
    for (let index = 0; index < length && offset + index < buffer.byteLength; index += 1) {
      value += String.fromCharCode(view.getUint8(offset + index));
    }
    return value;
  };
  if (text(0, 4) !== "RIFF" || text(8, 4) !== "WAVE") return 0;
  let offset = 12;
  let channels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let dataSize = 0;
  while (offset + 8 <= buffer.byteLength) {
    const chunkId = text(offset, 4);
    const chunkSize = view.getUint32(offset + 4, true);
    const chunkStart = offset + 8;
    if (chunkId === "fmt " && chunkStart + 16 <= buffer.byteLength) {
      channels = view.getUint16(chunkStart + 2, true);
      sampleRate = view.getUint32(chunkStart + 4, true);
      bitsPerSample = view.getUint16(chunkStart + 14, true);
    } else if (chunkId === "data") {
      dataSize = chunkSize;
      break;
    }
    offset = chunkStart + chunkSize + (chunkSize % 2);
  }
  const bytesPerSecond = sampleRate * channels * (bitsPerSample / 8);
  if (!bytesPerSecond || !dataSize) return 0;
  return normalizeAudioDurationValue(dataSize / bytesPerSecond);
}

function buildAudioDurationCacheKey(message: {
  image_name?: string | null;
  image_size_bytes?: number | null;
  image_mime_type?: string | null;
}) {
  const name = String(message.image_name || "").trim();
  const size = Number(message.image_size_bytes || 0);
  const mime = String(message.image_mime_type || "").trim().toLowerCase();
  if (!name || !size || !mime) return "";
  return `${name}|${size}|${mime}`;
}

function ConsultAudioMessage({
  url,
  locale,
  initialDurationSec = 0,
  mine = false,
  onDurationResolved
}: {
  url: string | null;
  locale: "zh" | "en";
  initialDurationSec?: number;
  mine?: boolean;
  onDurationResolved?: (durationSec: number) => void;
}) {
  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  const candidates = React.useMemo(() => buildAudioPlaybackCandidates(url), [url]);
  const [candidateIndex, setCandidateIndex] = React.useState(0);
  const [durationSec, setDurationSec] = React.useState(normalizeAudioDurationValue(initialDurationSec));
  const [currentSec, setCurrentSec] = React.useState(0);
  const [playing, setPlaying] = React.useState(false);
  const activeUrl = candidates[candidateIndex] || "";
  React.useEffect(() => {
    setCandidateIndex(0);
    setPlaying(false);
    setCurrentSec(0);
  }, [url]);
  React.useEffect(() => {
    const next = normalizeAudioDurationValue(initialDurationSec);
    if (next > 0) setDurationSec(next);
  }, [initialDurationSec]);
  React.useEffect(() => {
    const trustedInitial = normalizeAudioDurationValue(initialDurationSec);
    if (!activeUrl || trustedInitial > 0) return;
    const AudioContextCtor = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextCtor) return;
    let cancelled = false;
    const context = new AudioContextCtor();
    void fetch(activeUrl)
      .then((res) => (res.ok ? res.arrayBuffer() : null))
      .then(async (buffer) => {
        if (cancelled || !buffer) return;
        const wavDuration = parseWavDuration(buffer);
        if (wavDuration > 0) {
          setDurationSec(wavDuration);
          onDurationResolved?.(wavDuration);
          return;
        }
        const decoded = await context.decodeAudioData(buffer.slice(0));
        if (cancelled || !decoded) return;
        const decodedDuration = normalizeAudioDurationValue(decoded.duration);
        if (decodedDuration <= 0) return;
        setDurationSec(decodedDuration);
        onDurationResolved?.(decodedDuration);
      })
      .catch(() => {
        // ignore
      })
      .finally(() => {
        void context.close().catch(() => null);
      });
    return () => {
      cancelled = true;
      void context.close().catch(() => null);
    };
  }, [activeUrl, initialDurationSec, onDurationResolved]);
  if (!activeUrl) return null;
  const safeDuration = Math.max(durationSec, currentSec, 0);
  const progress = safeDuration > 0 ? Math.min(100, (currentSec / safeDuration) * 100) : 0;
  return (
    <div
      className={[
        "mt-2 inline-flex w-[220px] max-w-[68vw] items-center rounded-[18px] border px-2.5 py-2",
        mine
          ? "border-white/12 bg-white/[0.12] text-white"
          : "border-white/10 bg-white/[0.04] text-white/90"
      ].join(" ")}
    >
      <audio
        ref={audioRef}
        preload="metadata"
        src={activeUrl}
        className="hidden"
        onError={() => {
          setPlaying(false);
          setCandidateIndex((prev) => (prev + 1 < candidates.length ? prev + 1 : prev));
        }}
        onLoadedMetadata={(event) => {
          const incomingDuration = normalizeAudioDurationValue(Number(event.currentTarget.duration || 0));
          if (incomingDuration <= 0) return;
          const trustedInitial = normalizeAudioDurationValue(initialDurationSec);
          if (trustedInitial > 0) {
            const delta = Math.abs(incomingDuration - trustedInitial);
            const ratio = incomingDuration / Math.max(trustedInitial, 0.01);
            if (delta > 2 && ratio > 1.75) {
              setDurationSec(trustedInitial);
              return;
            }
          }
          setDurationSec(incomingDuration);
          onDurationResolved?.(incomingDuration);
        }}
        onTimeUpdate={(event) => {
          setCurrentSec(Number(event.currentTarget.currentTime || 0));
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={(event) => {
          setPlaying(false);
          event.currentTarget.currentTime = 0;
          setCurrentSec(0);
        }}
      />
      <div className="flex w-full items-center gap-2">
        <button
          type="button"
          onClick={async () => {
            const audio = audioRef.current;
            if (!audio) return;
            try {
              if (audio.paused) {
                if (audio.ended || audio.currentTime >= Math.max(Number(audio.duration || 0) - 0.05, 0)) {
                  audio.currentTime = 0;
                }
                if (audio.readyState < 2) {
                  audio.load();
                  await new Promise<void>((resolve) => {
                    const done = () => {
                      audio.removeEventListener("canplay", done);
                      audio.removeEventListener("loadedmetadata", done);
                      audio.removeEventListener("error", done);
                      resolve();
                    };
                    audio.addEventListener("canplay", done, { once: true });
                    audio.addEventListener("loadedmetadata", done, { once: true });
                    audio.addEventListener("error", done, { once: true });
                    window.setTimeout(done, 1200);
                  });
                }
                await audio.play();
              } else {
                audio.pause();
              }
            } catch {
              setPlaying(false);
              setCandidateIndex((prev) => (prev + 1 < candidates.length ? prev + 1 : prev));
            }
          }}
          className={[
            "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border",
            mine ? "border-white/16 bg-white/[0.13] text-white" : "border-white/10 bg-white/[0.06] text-white/88"
          ].join(" ")}
          aria-label={playing ? (locale === "zh" ? "暂停语音" : "Pause voice") : locale === "zh" ? "播放语音" : "Play voice"}
        >
          {playing ? (
            <Pause className="h-4 w-4" strokeWidth={2.4} />
          ) : (
            <Play className="h-4 w-4 translate-x-[1px]" fill="currentColor" strokeWidth={0} />
          )}
        </button>
        <div className="min-w-0 flex-1">
          <div className="h-2 overflow-hidden rounded-full bg-black/18">
            <div
              className="h-full rounded-full bg-sky-200/90 transition-[width] duration-150"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="mt-1 flex items-center text-[13px] leading-none text-white/68">
            <span>{formatAudioDuration(safeDuration, locale)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function ConsultMessageImage({
  url,
  name,
  mimeType,
  onOpen,
  locale
}: {
  url: string | null;
  name: string | null;
  mimeType: string | null;
  onOpen: () => void;
  locale: "zh" | "en";
}) {
  const candidates = React.useMemo(() => buildImagePreviewCandidates(url), [url]);
  const [candidateIndex, setCandidateIndex] = React.useState(0);
  const activeUrl = candidates[candidateIndex] || "";

  React.useEffect(() => {
    setCandidateIndex(0);
  }, [url]);

  return (
    <button type="button" onClick={onOpen} className="mt-2 block cursor-zoom-in text-left">
      {activeUrl ? (
        <img
          src={activeUrl}
          alt={name || "image"}
          className="max-h-64 rounded-xl border border-white/10 object-contain"
          onError={() => {
            setCandidateIndex((prev) => (prev + 1 < candidates.length ? prev + 1 : prev));
          }}
        />
      ) : (
        <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-xs text-white/55">
          {locale === "zh" ? "图片暂时无法显示，点击尝试预览" : "Image unavailable. Tap to preview."}
        </div>
      )}
    </button>
  );
}

export function ConsultClient({
  locale,
  initialMeId = "",
  initialRecipients = [],
  initialUnreadByPeer = {},
  initialLatestByPeer = {},
  forceMobileApp = false
}: ConsultClientProps) {
  const normalizeMessage = React.useCallback(
    (message: Message): Message => ({
      ...message,
      content_text: message.content_text ? repairMojibake(message.content_text) : message.content_text,
      image_name: message.image_name ? repairMojibake(message.image_name) : message.image_name,
      audio_duration_sec: normalizeAudioDurationValue(Number(message.audio_duration_sec || 0), 0) || null,
      reply_to: message.reply_to
        ? {
            ...message.reply_to,
            content_text: message.reply_to.content_text
              ? repairMojibake(message.reply_to.content_text)
              : message.reply_to.content_text,
            image_name: message.reply_to.image_name
              ? repairMojibake(message.reply_to.image_name)
              : message.reply_to.image_name
          }
        : message.reply_to
    }),
    []
  );
  const normalizedInitialRecipients = Array.isArray(initialRecipients) ? initialRecipients : [];
  const normalizedInitialUnread =
    initialUnreadByPeer && typeof initialUnreadByPeer === "object" ? initialUnreadByPeer : {};
  const normalizedInitialLatest =
    initialLatestByPeer && typeof initialLatestByPeer === "object" ? initialLatestByPeer : {};
  const [meId, setMeId] = React.useState(() => String(initialMeId || "").trim());
  const [recipients, setRecipients] = React.useState<Recipient[]>(() => normalizedInitialRecipients);
  const [contactsCollapsed, setContactsCollapsed] = React.useState(false);
  const [contactsMotion, setContactsMotion] = React.useState<"collapse" | "expand" | null>(null);
  const [unreadByPeer, setUnreadByPeer] = React.useState<Record<string, number>>(() => normalizedInitialUnread);
  const [latestByPeer, setLatestByPeer] = React.useState<Record<string, string>>(() => normalizedInitialLatest);
  const [query, setQuery] = React.useState("");
  const [selectedId, setSelectedId] = React.useState<string>("");
  const [loadingRecipients, setLoadingRecipients] = React.useState(() => normalizedInitialRecipients.length === 0);
  const [messages, setMessages] = React.useState<Message[]>([]);
  const [error, setError] = React.useState("");
  const [text, setText] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [recallingId, setRecallingId] = React.useState<string | null>(null);
  const [copiedId, setCopiedId] = React.useState<string | null>(null);
  const [emojiOpen, setEmojiOpen] = React.useState(false);
  const [emojiTab, setEmojiTab] = React.useState<EmojiTab>("recent");
  const [emojiPage, setEmojiPage] = React.useState(1);
  const [recentEmojis, setRecentEmojis] = React.useState<string[]>(DEFAULT_RECENTS);
  const [imageFile, setImageFile] = React.useState<File | null>(null);
  const [recording, setRecording] = React.useState(false);
  const [recordingPreparing, setRecordingPreparing] = React.useState(false);
  const [recordingMs, setRecordingMs] = React.useState(0);
  const [pinnedPeers, setPinnedPeers] = React.useState<Set<string>>(() => new Set());
  const [contactContextMenu, setContactContextMenu] = React.useState<{ id: string; x: number; y: number } | null>(
    null
  );
  const [messageContextMenu, setMessageContextMenu] = React.useState<{ message: Message; x: number; y: number } | null>(
    null
  );
  const [replyTarget, setReplyTarget] = React.useState<Message | null>(null);
  const [focusedMessageId, setFocusedMessageId] = React.useState<string | null>(null);
  const [previewFile, setPreviewFile] = React.useState<{
    name: string;
    url: string | null;
    mimeType: string | null;
  } | null>(null);
  const [alertsEnabled, setAlertsEnabled] = React.useState(true);
  const [isMobileApp, setIsMobileApp] = React.useState(forceMobileApp);
  const [mobileChatOpen, setMobileChatOpen] = React.useState(false);
  const [mobileComposerMode, setMobileComposerMode] = React.useState<"text" | "voice">("text");
  const [callSession, setCallSession] = React.useState<CallSession | null>(null);
  const [callDirection, setCallDirection] = React.useState<"incoming" | "outgoing" | null>(null);
  const [callPhase, setCallPhase] = React.useState<"idle" | "ringing" | "connecting" | "active">("idle");
  const [callMuted, setCallMuted] = React.useState(false);
  const [callSpeaker, setCallSpeaker] = React.useState(true);
  const listRef = React.useRef<HTMLDivElement | null>(null);
  const contactsListRef = React.useRef<HTMLDivElement | null>(null);
  const fileRef = React.useRef<HTMLInputElement | null>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);
  const selectedRef = React.useRef(selectedId);
  const recipientsRef = React.useRef<Recipient[]>(normalizedInitialRecipients);
  const sendingRef = React.useRef(false);
  const messagesRef = React.useRef<Message[]>([]);
  const unreadInitRef = React.useRef(Object.keys(normalizedInitialUnread).length > 0);
  const unreadPrevRef = React.useRef<Record<string, number>>(normalizedInitialUnread);
  const unreadByPeerRef = React.useRef<Record<string, number>>(normalizedInitialUnread);
  const audioRef = React.useRef<AudioContext | null>(null);
  const audioPrimedRef = React.useRef(false);
  const mediaRecorderRef = React.useRef<MediaRecorder | null>(null);
  const mediaStreamRef = React.useRef<MediaStream | null>(null);
  const audioChunksRef = React.useRef<Blob[]>([]);
  const recordHoldActiveRef = React.useRef(false);
  const recordStartPendingRef = React.useRef(false);
  const recordStartedAtRef = React.useRef(0);
  const recordTimerRef = React.useRef<number | null>(null);
  const recordPressTimerRef = React.useRef<number | null>(null);
  const recordPointerIdRef = React.useRef<number | null>(null);
  const recordAudioFocusActiveRef = React.useRef(false);
  const callAudioFocusActiveRef = React.useRef(false);
  const callPeerConnectionRef = React.useRef<RTCPeerConnection | null>(null);
  const callLocalStreamRef = React.useRef<MediaStream | null>(null);
  const callRemoteAudioRef = React.useRef<HTMLAudioElement | null>(null);
  const callSignalsAfterIdRef = React.useRef(0);
  const callOfferSentRef = React.useRef(false);
  const callIceRestartedRef = React.useRef(false);
  const lastAlertAtRef = React.useRef(0);
  const callRingTimerRef = React.useRef<number | null>(null);
  const callStartPendingPeerIdRef = React.useRef("");
  const callStartPendingUntilRef = React.useRef(0);
  const callIgnoredSessionIdRef = React.useRef("");
  const callIgnoredSessionUntilRef = React.useRef(0);
  const callAcceptingSessionIdRef = React.useRef("");
  const callAcceptingSessionUntilRef = React.useRef(0);
  const callSessionRef = React.useRef<CallSession | null>(null);
  const callDirectionRef = React.useRef<"incoming" | "outgoing" | null>(null);
  const callPhaseRef = React.useRef<"idle" | "ringing" | "connecting" | "active">("idle");
  const callActionSeqRef = React.useRef(0);
  const pendingRemoteIceCandidatesRef = React.useRef<RTCIceCandidateInit[]>([]);
  const copyTimerRef = React.useRef<number | null>(null);
  const objectUrlRegistryRef = React.useRef<Set<string>>(new Set());
  const audioDurationCacheRef = React.useRef<Map<string, number>>(new Map());
  const lastRecordedDurationSecRef = React.useRef(0);
  const recipientsRetryTimerRef = React.useRef<number | null>(null);
  const recipientsRetryAttemptRef = React.useRef(0);
  const loadRecipientsRef = React.useRef<(force?: boolean, withSpinner?: boolean) => Promise<void>>();
  const lastMessageAtRef = React.useRef<string | null>(null);
  const stickToBottomRef = React.useRef(true);
  const lastScrollTopRef = React.useRef(0);
  const recipientsPendingRef = React.useRef(false);
  const unreadPendingRef = React.useRef(false);
  const messagesPendingKeysRef = React.useRef<Set<string>>(new Set());
  const messagesCacheRef = React.useRef<Map<string, Message[]>>(new Map());
  const lastRecipientsFetchAtRef = React.useRef(0);
  const lastUnreadFetchAtRef = React.useRef(0);
  const lastMessagesFetchAtRef = React.useRef(0);
  const messageNodeMapRef = React.useRef<Map<string, HTMLDivElement>>(new Map());
  const focusedMessageTimerRef = React.useRef<number | null>(null);
  const callPollNowRef = React.useRef<(() => void) | null>(null);

  React.useEffect(() => {
    callSessionRef.current = callSession;
  }, [callSession]);

  React.useEffect(() => {
    callDirectionRef.current = callDirection;
  }, [callDirection]);

  React.useEffect(() => {
    callPhaseRef.current = callPhase;
  }, [callPhase]);

  const getCachedAudioDuration = React.useCallback((message: Message) => {
    const key = buildAudioDurationCacheKey(message);
    if (!key) return 0;
    return normalizeAudioDurationValue(Number(audioDurationCacheRef.current.get(key) || 0));
  }, []);

  const rememberAudioDuration = React.useCallback((message: Message, durationSec: number) => {
    const normalized = normalizeAudioDurationValue(durationSec);
    if (normalized <= 0) return;
    const key = buildAudioDurationCacheKey(message);
    if (!key) return;
    const prev = Number(audioDurationCacheRef.current.get(key) || 0);
    if (prev > 0 && Math.abs(prev - normalized) < 0.25) return;
    audioDurationCacheRef.current.set(key, normalized);
    setMessages((current) =>
      current.map((item) => (item.id === message.id ? { ...item, audio_duration_sec: normalized } : item))
    );
  }, []);

  const mergeLatestByPeer = React.useCallback((peerId: string, createdAt: string | null | undefined) => {
    const key = String(peerId || "").trim();
    const value = String(createdAt || "").trim();
    if (!key || !value) return;
    const valueTs = parseTimeToNumber(value);
    if (!valueTs) return;
    setLatestByPeer((prev) => {
      const existing = String(prev[key] || "").trim();
      if (!existing) return { ...prev, [key]: value };
      const existingTs = parseTimeToNumber(existing);
      if (!existingTs || valueTs >= existingTs) {
        return { ...prev, [key]: value };
      }
      return prev;
    });
  }, []);

  const getStorageValue = React.useCallback((key: string) => {
    if (typeof window === "undefined") return null;
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }, []);

  const setStorageValue = React.useCallback((key: string, value: string) => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // ignore
    }
  }, []);

  const requestNativeMicrophonePermission = React.useCallback(async () => {
    if (!isMobileApp) return true;
    const plugin = getCapacitorPlugin<{
      requestMicrophone?: () => Promise<{ granted?: boolean; microphone?: string }>;
      checkMicrophone?: () => Promise<{ granted?: boolean; microphone?: string }>;
    }>("FxLocusPermissions");
    if (!plugin?.requestMicrophone) return true;
    try {
      const result = await plugin.requestMicrophone();
      return result?.granted !== false && result?.microphone !== "denied";
    } catch {
      return true;
    }
  }, [isMobileApp]);

  const requestNativeAudioFocus = React.useCallback(async (mode: "recording" | "call" = "recording") => {
    if (!isMobileApp) return false;
    const plugin = getCapacitorPlugin<{
      requestAudioFocus?: (options?: { mode?: "recording" | "call" }) => Promise<{ granted?: boolean }>;
    }>("FxLocusPermissions");
    if (!plugin?.requestAudioFocus) return false;
    try {
      const result = await plugin.requestAudioFocus({ mode });
      return result?.granted !== false;
    } catch {
      return false;
    }
  }, [isMobileApp]);

  const abandonNativeAudioFocus = React.useCallback(async () => {
    if (!isMobileApp) return;
    const plugin = getCapacitorPlugin<{
      abandonAudioFocus?: () => Promise<void>;
    }>("FxLocusPermissions");
    try {
      await plugin?.abandonAudioFocus?.();
    } catch {
      // ignore
    }
  }, [isMobileApp]);

  const openMicrophoneStream = React.useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("media_devices_unavailable");
    }
    const granted = await requestNativeMicrophonePermission();
    if (!granted) {
      throw new Error("microphone_permission_denied");
    }
    await waitForMs(isMobileApp ? 320 : 0);
    try {
      return await navigator.mediaDevices.getUserMedia(buildAudioConstraints());
    } catch (firstError) {
      const errorName = String((firstError as any)?.name || "").toLowerCase();
      const errorMessage = String((firstError as any)?.message || "").toLowerCase();
      if (
        errorName.includes("notreadable") ||
        errorName.includes("trackstart") ||
        errorMessage.includes("could not start") ||
        errorMessage.includes("device in use") ||
        errorMessage.includes("device is in use")
      ) {
        throw new Error("microphone_in_use");
      }
      await waitForMs(isMobileApp ? 900 : 300);
      await requestNativeMicrophonePermission();
      try {
        return await navigator.mediaDevices.getUserMedia(buildAudioConstraints());
      } catch {
        await waitForMs(220);
        try {
          return await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch {
          throw firstError;
        }
      }
    }
  }, [isMobileApp, requestNativeMicrophonePermission]);

  const messageCacheKey = React.useCallback(
    (peerId: string) => `fxlocus_consult_messages_${meId}_${peerId}`,
    [meId]
  );

  const readCachedMessages = React.useCallback(
    (peerId: string) => {
      if (!peerId) return [] as Message[];
      const inMemory = messagesCacheRef.current.get(peerId);
      if (inMemory?.length) return inMemory.map((item) => normalizeMessage({ ...item }));
      if (!meId) return [] as Message[];
      const raw = safeSessionStorageGet(messageCacheKey(peerId));
      if (!raw) return [] as Message[];
      try {
        const parsed = JSON.parse(raw) as { at?: number; items?: Message[] };
        const cachedAt = Number(parsed?.at || 0);
        if (!cachedAt || Date.now() - cachedAt > MESSAGE_CACHE_TTL_MS) return [] as Message[];
        const items = Array.isArray(parsed?.items)
          ? parsed.items.slice(-MESSAGE_CACHE_MAX_ITEMS).map(normalizeMessage)
          : [];
        if (!items.length) return [] as Message[];
        messagesCacheRef.current.set(peerId, items);
        return items.map((item) => ({ ...item }));
      } catch {
        return [] as Message[];
      }
    },
    [meId, messageCacheKey, normalizeMessage]
  );

  const rememberMessages = React.useCallback(
    (peerId: string, items: Message[]) => {
      if (!peerId || !Array.isArray(items)) return;
      const next = items.slice(-MESSAGE_CACHE_MAX_ITEMS).map((item) => normalizeMessage({ ...item }));
      messagesCacheRef.current.set(peerId, next);
      if (!meId) return;
      safeSessionStorageSet(
        messageCacheKey(peerId),
        JSON.stringify({
          at: Date.now(),
          items: next
        })
      );
    },
    [meId, messageCacheKey, normalizeMessage]
  );

  React.useEffect(() => {
    selectedRef.current = selectedId;
  }, [selectedId]);

  React.useEffect(() => {
    recipientsRef.current = recipients;
  }, [recipients]);

  React.useEffect(() => {
    unreadByPeerRef.current = unreadByPeer;
  }, [unreadByPeer]);

  React.useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  React.useEffect(() => {
    if (forceMobileApp) {
      setIsMobileApp(true);
      return;
    }
    const syncMobileState = () => {
      setIsMobileApp(
        document.documentElement.getAttribute("data-mobile-app") === "1" && window.innerWidth <= 767
      );
    };
    syncMobileState();
    window.addEventListener("resize", syncMobileState);
    return () => {
      window.removeEventListener("resize", syncMobileState);
    };
  }, [forceMobileApp]);

  React.useEffect(() => {
    if (isMobileApp) return;
    setMobileChatOpen(false);
  }, [isMobileApp]);

  React.useEffect(() => {
    const stored = safeStorageGet(RECENT_EMOJI_KEY);
    if (!stored) return;
    try {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        const normalized = normalizeEmojiList(parsed);
        if (normalized.length) setRecentEmojis(normalized);
      }
    } catch {
      // ignore
    }
  }, []);

  React.useEffect(() => {
    const raw = safeStorageGet(ALERT_SETTINGS_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed?.alertsEnabled === "boolean") setAlertsEnabled(parsed.alertsEnabled);
      if (typeof parsed?.contactsCollapsed === "boolean") setContactsCollapsed(parsed.contactsCollapsed);
    } catch {
      // ignore
    }
  }, []);

  React.useEffect(() => {
    safeStorageSet(
      ALERT_SETTINGS_KEY,
      JSON.stringify({
        alertsEnabled,
        contactsCollapsed
      })
    );
  }, [alertsEnabled, contactsCollapsed]);

  React.useEffect(() => {
    if (contactsMotion === null) return;
    const timer = window.setTimeout(() => setContactsMotion(null), 320);
    return () => window.clearTimeout(timer);
  }, [contactsMotion]);

  React.useEffect(() => {
    if (isMobileApp) return;
    const container = document.querySelector(".system-main > .flex-1");
    if (!container) return;
    container.classList.add("system-consult-no-scroll");
    document.documentElement.classList.add("system-consult-lock");
    document.body.classList.add("system-consult-lock");
    return () => {
      container.classList.remove("system-consult-no-scroll");
      document.documentElement.classList.remove("system-consult-lock");
      document.body.classList.remove("system-consult-lock");
    };
  }, [isMobileApp]);

  React.useEffect(() => {
    if (isMobileApp) return;
    const content = document.querySelector(".system-content");
    if (!content) return;
    content.classList.add("system-consult-content");
    return () => {
      content.classList.remove("system-consult-content");
    };
  }, [isMobileApp]);

  React.useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
        copyTimerRef.current = null;
      }
      if (recipientsRetryTimerRef.current !== null) {
        window.clearTimeout(recipientsRetryTimerRef.current);
        recipientsRetryTimerRef.current = null;
      }
      if (focusedMessageTimerRef.current !== null) {
        window.clearTimeout(focusedMessageTimerRef.current);
        focusedMessageTimerRef.current = null;
      }
      if (recordTimerRef.current !== null) {
        window.clearInterval(recordTimerRef.current);
        recordTimerRef.current = null;
      }
      if (recordPressTimerRef.current !== null) {
        window.clearTimeout(recordPressTimerRef.current);
        recordPressTimerRef.current = null;
      }
      recordPointerIdRef.current = null;
      if (callRingTimerRef.current !== null) {
        window.clearInterval(callRingTimerRef.current);
        callRingTimerRef.current = null;
      }
      mediaRecorderRef.current?.stop?.();
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
      if (recordAudioFocusActiveRef.current) {
        recordAudioFocusActiveRef.current = false;
        const plugin = getCapacitorPlugin<{ abandonAudioFocus?: () => Promise<void> }>("FxLocusPermissions");
        void plugin?.abandonAudioFocus?.().catch(() => {});
      }
      if (callPeerConnectionRef.current) {
        try {
          callPeerConnectionRef.current.close();
        } catch {
          // ignore
        }
        callPeerConnectionRef.current = null;
      }
      if (callLocalStreamRef.current) {
        callLocalStreamRef.current.getTracks().forEach((track) => track.stop());
        callLocalStreamRef.current = null;
      }
      objectUrlRegistryRef.current.forEach((url) => {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // ignore
        }
      });
      objectUrlRegistryRef.current.clear();
    };
  }, []);

  React.useEffect(() => {
    if (meId) return;
    let alive = true;
    (async () => {
      try {
        const result = await fetchSystemJson<{ ok?: boolean; user?: { id?: string } }>("/api/system/me", {
          dedupeKey: "consult:me",
          retries: 1,
          dedupeWindowMs: 3000
        });
        const json = (result.body || null) as any;
        if (!alive) return;
        if (result.ok && json?.ok) setMeId(String(json.user?.id || ""));
      } catch {
        // ignore
      }
    })();
    return () => {
      alive = false;
    };
  }, [meId]);

  React.useEffect(() => {
    if (!meId) return;
    const key = `fxlocus_consult_pins_${meId}`;
    const stored = safeStorageGet(key);
    if (!stored) return;
    try {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        setPinnedPeers(new Set(parsed.map(String)));
      }
    } catch {
      // ignore
    }
  }, [meId]);

  React.useEffect(() => {
    if (!meId) return;
    const key = `fxlocus_consult_pins_${meId}`;
    safeStorageSet(key, JSON.stringify(Array.from(pinnedPeers)));
  }, [meId, pinnedPeers]);

  const scheduleRecipientsRetry = React.useCallback((baseDelayMs = 1200) => {
    if (typeof window === "undefined") return;
    if (recipientsRetryTimerRef.current !== null) return;
    const attempt = Math.min(recipientsRetryAttemptRef.current, 6);
    const delay = Math.min(10_000, baseDelayMs * 2 ** attempt) + Math.floor(Math.random() * 240);
    recipientsRetryTimerRef.current = window.setTimeout(() => {
      recipientsRetryTimerRef.current = null;
      recipientsRetryAttemptRef.current = Math.min(recipientsRetryAttemptRef.current + 1, 8);
      const load = loadRecipientsRef.current;
      if (typeof load === "function") void load(true, true);
    }, delay);
  }, []);

  const clearRecipientsRetry = React.useCallback(() => {
    if (recipientsRetryTimerRef.current !== null) {
      window.clearTimeout(recipientsRetryTimerRef.current);
      recipientsRetryTimerRef.current = null;
    }
    recipientsRetryAttemptRef.current = 0;
  }, []);

  const switchMobileAppToConsult = React.useCallback(() => {
    if (!isMobileApp) return;
    setMobilePrimaryTabHref("/system/consult", { locale, role: "student" });
  }, [isMobileApp, locale]);

  const loadRecipients = React.useCallback(async (force = false, withSpinner = false) => {
    const hasRecipients = recipientsRef.current.length > 0;
    const initialLoad = withSpinner && !hasRecipients;
    const forceFetch = force || initialLoad;
    const now = Date.now();
    const minRecipientIntervalMs = isMobileApp ? 900 : 8000;
    if (!forceFetch && now - lastRecipientsFetchAtRef.current < minRecipientIntervalMs) {
      if (initialLoad) scheduleRecipientsRetry(900);
      return;
    }
    if (!forceFetch && !acquireGlobalPollSlot("consult:recipients", isMobileApp ? 900 : 10_000)) {
      if (initialLoad) scheduleRecipientsRetry(900);
      return;
    }
    if (recipientsPendingRef.current) {
      if (initialLoad) scheduleRecipientsRetry(700);
      return;
    }
    recipientsPendingRef.current = true;
    lastRecipientsFetchAtRef.current = now;
    if (initialLoad) setLoadingRecipients(true);
    try {
      const result = await fetchSystemJson<{ ok?: boolean; items?: Recipient[] }>("/api/system/consult/recipients", {
        fresh: forceFetch,
        dedupeKey: "consult:recipients",
        retries: 2,
        retryBaseMs: 260,
        retryMaxMs: 1400,
        dedupeWindowMs: forceFetch ? 250 : 1200,
        preferStale: !forceFetch,
        revalidateInBackground: !forceFetch,
        staleTtlMs: 5 * 60_000
      });
      const json = (result.body || null) as any;
      if (!result.ok || !json?.ok) {
        if (!hasRecipients) scheduleRecipientsRetry(1200);
        return;
      }
      const items = Array.isArray(json?.items) ? json.items : [];
      const transientFallback = Boolean(json?.transient);
      if (transientFallback && !items.length && !hasRecipients) {
        scheduleRecipientsRetry(1200);
      } else {
        clearRecipientsRetry();
      }
      setRecipients(items);
      setLatestByPeer((prev) => {
        const next = { ...prev };
        items.forEach((item: Recipient) => {
          const incoming = String(item?.last_message_at || "").trim();
          if (!incoming) return;
          const incomingTs = parseTimeToNumber(incoming);
          if (!incomingTs) return;
          const existing = String(next[item.id] || "").trim();
          if (!existing || incomingTs >= parseTimeToNumber(existing)) {
            next[item.id] = incoming;
          }
        });
        return next;
      });
      // defer selection until latest message map is available
    } catch {
      if (!hasRecipients) scheduleRecipientsRetry(1300);
      // keep current recipients on transient failures
    } finally {
      recipientsPendingRef.current = false;
      if (withSpinner) setLoadingRecipients(false);
    }
  }, [clearRecipientsRetry, isMobileApp, scheduleRecipientsRetry]);

  React.useEffect(() => {
    loadRecipientsRef.current = loadRecipients;
  }, [loadRecipients]);

  const primeAudio = React.useCallback(async () => {
    try {
      const AudioContextCtor = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextCtor) return null;
      const ctx: AudioContext = audioRef.current || new AudioContextCtor();
      audioRef.current = ctx;
      if (ctx.state === "suspended") {
        await ctx.resume().catch(() => null);
      }
      if (ctx.state !== "running") return ctx;
      if (!audioPrimedRef.current) {
        const oscillator = ctx.createOscillator();
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.0001, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.015);
        oscillator.connect(gain);
        gain.connect(ctx.destination);
        oscillator.start(ctx.currentTime);
        oscillator.stop(ctx.currentTime + 0.015);
        audioPrimedRef.current = true;
      }
      return ctx;
    } catch {
      return null;
    }
  }, []);

  const playAlertTone = React.useCallback(async () => {
    try {
      const ctx = await primeAudio();
      if (!ctx || ctx.state !== "running") return;
      let cursor = ctx.currentTime;
      ALERT_TONE_STEPS.forEach((step) => {
        const oscillator = ctx.createOscillator();
        const gain = ctx.createGain();
        oscillator.type = "sine";
        oscillator.frequency.value = step.freq;
        const volume = typeof step.gain === "number" ? step.gain : 0.09;
        gain.gain.setValueAtTime(0.0001, cursor);
        gain.gain.exponentialRampToValueAtTime(volume, cursor + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, cursor + step.duration);
        oscillator.connect(gain);
        gain.connect(ctx.destination);
        oscillator.start(cursor);
        oscillator.stop(cursor + step.duration + 0.01);
        cursor += step.duration + 0.02;
      });
    } catch {
      // ignore
    }
  }, [primeAudio]);

  const notifyIncomingMessage = React.useCallback(() => {
    if (!alertsEnabled) return;
    const now = Date.now();
    if (now - lastAlertAtRef.current < 380) return;
    if (typeof window !== "undefined") {
      const globalKey = "__fx_last_mobile_consult_alert_at";
      const w = window as any;
      const lastGlobal = Number(w[globalKey] || 0);
      if (lastGlobal && now - lastGlobal < 900) return;
      w[globalKey] = now;
    }
    lastAlertAtRef.current = now;
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      navigator.vibrate([160, 70, 220]);
    }
    void playAlertTone();
  }, [alertsEnabled, playAlertTone]);

  const startCallRinging = React.useCallback(() => {
    if (callRingTimerRef.current !== null) return;
    const nativePlugin = getCapacitorPlugin<{ playIncomingCallAlert?: () => Promise<void> }>("FxLocusPermissions");
    void nativePlugin?.playIncomingCallAlert?.().catch(() => {});
    void playAlertTone();
    callRingTimerRef.current = window.setInterval(() => {
      void nativePlugin?.playIncomingCallAlert?.().catch(() => {});
      void playAlertTone();
      if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
        navigator.vibrate([180, 90, 180]);
      }
    }, 1800);
  }, [playAlertTone]);

  const stopCallRinging = React.useCallback(() => {
    const nativePlugin = getCapacitorPlugin<{ stopIncomingCallAlert?: () => Promise<void> }>("FxLocusPermissions");
    void nativePlugin?.stopIncomingCallAlert?.().catch(() => {});
    if (callRingTimerRef.current !== null) {
      window.clearInterval(callRingTimerRef.current);
      callRingTimerRef.current = null;
    }
  }, []);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const unlock = () => {
      void primeAudio();
    };
    window.addEventListener("pointerdown", unlock, { passive: true });
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, [primeAudio]);

  const loadUnreadCounts = React.useCallback(async (force = false) => {
    const now = Date.now();
    const minUnreadIntervalMs = isMobileApp ? 350 : 5000;
    if (!force && now - lastUnreadFetchAtRef.current < minUnreadIntervalMs) return;
    if (!force && !acquireGlobalPollSlot("consult:unread-by-peer", isMobileApp ? 350 : 7_000)) return;
    if (unreadPendingRef.current) return;
    unreadPendingRef.current = true;
    lastUnreadFetchAtRef.current = now;
    try {
      const unreadEndpoint = force
        ? "/api/system/consult/unread-by-peer?fresh=1&hard=1"
        : "/api/system/consult/unread-by-peer?fresh=1";
      const result = await fetchSystemJson<{ ok?: boolean; counts?: Record<string, number>; latest?: Record<string, string> }>(
        unreadEndpoint,
        {
          fresh: true,
          dedupeKey: force ? `consult:unread-by-peer:hard:${Date.now()}` : "consult:unread-by-peer:fresh",
          retries: 2,
          retryBaseMs: 260,
          retryMaxMs: 1400,
          dedupeWindowMs: 0,
          preferStale: false,
          revalidateInBackground: false,
          staleTtlMs: 0
        }
      );
      const json = (result.body || null) as any;
      if (!result.ok || !json?.ok) return;
      const rawCounts =
        json?.counts && typeof json.counts === "object"
          ? (json.counts as Record<string, number>)
          : {};
      const counts = { ...rawCounts };
      const activePeerId = selectedRef.current;
      if (activePeerId) counts[activePeerId] = 0;
      setUnreadByPeer(counts);
      const totalUnread = Object.values(counts).reduce(
        (sum: number, value) => sum + Math.max(0, Number(value || 0)),
        0
      );
      setLatestByPeer((prev) => {
        const incoming = json?.latest && typeof json.latest === "object" ? json.latest : {};
        const entries = Object.entries(incoming);
        if (!entries.length) return prev;
        const next = { ...prev };
        entries.forEach(([peerId, raw]) => {
          const value = String(raw || "").trim();
          if (!value) return;
          const ts = parseTimeToNumber(value);
          if (!ts) return;
          const existing = String(next[peerId] || "").trim();
          if (!existing || ts >= parseTimeToNumber(existing)) {
            next[peerId] = value;
          }
        });
        return next;
      });
      if (unreadInitRef.current) {
        const prev = unreadPrevRef.current || {};
        const prevTotal = Object.values(prev).reduce(
          (sum: number, value) => sum + Math.max(0, Number(value || 0)),
          0
        );
        const delta = totalUnread - prevTotal;
        if (delta !== 0) {
          dispatchSidebarDelta({ consultUnread: delta, holdMs: isMobileApp ? 450 : 1_200 }, "consult_unread_sync");
        }
        const increased = Object.keys(counts).some((key) => {
          const nextValue = Number(counts[key] || 0);
          const prevValue = Number(prev[key] || 0);
          return nextValue > prevValue;
        });
        if (increased) notifyIncomingMessage();
      }
      unreadPrevRef.current = counts;
      unreadInitRef.current = true;
    } catch {
      // ignore
    } finally {
      unreadPendingRef.current = false;
    }
  }, [isMobileApp, notifyIncomingMessage]);

  const loadMessages = React.useCallback(
    async (peerId: string, since?: string, force = false) => {
      if (!peerId) return;
      const now = Date.now();
      const minMessagesIntervalMs = isMobileApp ? 300 : 2500;
      if (!force && now - lastMessagesFetchAtRef.current < minMessagesIntervalMs) return;
      if (!force) {
        const slotKey = since ? `consult:messages:delta:${peerId}` : `consult:messages:full:${peerId}`;
        const slotMs = isMobileApp ? (since ? 300 : 700) : since ? 3_500 : 5_000;
        if (!acquireGlobalPollSlot(slotKey, slotMs)) return;
      }
      const pendingKey = `${peerId}:${since ? "since" : "full"}`;
      if (messagesPendingKeysRef.current.has(pendingKey)) return;
      messagesPendingKeysRef.current.add(pendingKey);
      lastMessagesFetchAtRef.current = now;
      try {
        const params = new URLSearchParams({ peerId });
        if (since) params.set("since", since);
        const requestUrl = `/api/system/consult/messages?${params.toString()}`;
        const allowStale = !since && !force;
        const result = await fetchSystemJson<{ ok?: boolean; items?: Message[] }>(requestUrl, {
          fresh: force,
          dedupeKey: `consult:messages:${peerId}:${since ? "since" : "full"}`,
          retries: 2,
          retryBaseMs: 260,
          retryMaxMs: 1400,
          dedupeWindowMs: isMobileApp ? 0 : since ? 600 : 200,
          preferStale: allowStale,
          revalidateInBackground: allowStale,
          staleTtlMs: allowStale ? 2 * 60_000 : 30_000
        });
        const json = (result.body || null) as any;
        if (!result.ok || !json?.ok) {
          if (!messagesRef.current.length) {
            setError(localizeConsultError(json?.error || result.errorCode || "load_failed", locale));
          }
          return;
        }
        setError("");
        const incoming: Message[] = (Array.isArray(json.items) ? json.items : []).map((item: Message) => {
          const normalized = {
            ...normalizeMessage(item),
            audio_duration_sec: normalizeAudioDurationValue(Number(item?.audio_duration_sec || 0), 0) || null
          };
          if (normalized.audio_duration_sec && normalized.audio_duration_sec > 0) return normalized;
          const cachedDuration = getCachedAudioDuration(normalized);
          return cachedDuration > 0 ? { ...normalized, audio_duration_sec: cachedDuration } : normalized;
        });
        if (since) {
          if (selectedRef.current !== peerId) return;
          if (incoming.length) {
            let hasFreshIncoming = false;
            setMessages((prev) => {
              const seen = new Set(prev.map((msg) => msg.id));
              const merged = [...prev];
              incoming.forEach((msg: Message) => {
                if (seen.has(msg.id)) return;
                seen.add(msg.id);
                merged.push(msg);
                if (msg.to_user_id === meId && msg.from_user_id === peerId) {
                  hasFreshIncoming = true;
                }
              });
              rememberMessages(peerId, merged);
              return merged;
            });
            if (hasFreshIncoming) notifyIncomingMessage();
          }
        } else {
          if (selectedRef.current !== peerId) return;
          rememberMessages(peerId, incoming);
          setMessages(incoming);
        }
        const latestCreatedAt = incoming.length ? String(incoming[incoming.length - 1]?.created_at || "") : "";
        if (latestCreatedAt) {
          lastMessageAtRef.current = latestCreatedAt;
          mergeLatestByPeer(peerId, latestCreatedAt);
        }
      } catch {
        if (!messagesRef.current.length) {
          setError(localizeConsultError("load_failed", locale));
        }
      } finally {
        messagesPendingKeysRef.current.delete(pendingKey);
      }
    },
    [getCachedAudioDuration, isMobileApp, locale, meId, mergeLatestByPeer, normalizeMessage, notifyIncomingMessage, rememberMessages]
  );

  const copyToClipboard = React.useCallback(async (value: string) => {
    if (!value) return false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        return true;
      }
    } catch {
      // fall through to legacy method
    }
    try {
      const textarea = document.createElement("textarea");
      textarea.value = value;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      textarea.style.left = "-9999px";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(textarea);
      return ok;
    } catch {
      return false;
    }
  }, []);

  const registerMessageNode = React.useCallback((messageId: string, node: HTMLDivElement | null) => {
    const key = String(messageId || "").trim();
    if (!key) return;
    if (node) {
      messageNodeMapRef.current.set(key, node);
    } else {
      messageNodeMapRef.current.delete(key);
    }
  }, []);

  const jumpToMessage = React.useCallback((targetMessageId: string) => {
    const id = String(targetMessageId || "").trim();
    if (!id) return;
    const targetNode = messageNodeMapRef.current.get(id);
    if (!targetNode) return;

    targetNode.scrollIntoView({
      behavior: "smooth",
      block: "center"
    });
    setFocusedMessageId(id);
    if (focusedMessageTimerRef.current !== null) {
      window.clearTimeout(focusedMessageTimerRef.current);
    }
    focusedMessageTimerRef.current = window.setTimeout(() => {
      setFocusedMessageId((current) => (current === id ? null : current));
      focusedMessageTimerRef.current = null;
    }, 1800);
  }, []);

  const copyMessage = React.useCallback(
    async (msg: Message) => {
      const text = msg.content_text?.trim() || msg.image_url || "";
      if (!text) return;
      const ok = await copyToClipboard(text);
      if (!ok) return;
      setCopiedId(msg.id);
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
      copyTimerRef.current = window.setTimeout(() => {
        setCopiedId((prev) => (prev === msg.id ? null : prev));
        copyTimerRef.current = null;
      }, 1600);
    },
    [copyToClipboard]
  );

  React.useEffect(() => {
    const noRecipients = recipientsRef.current.length === 0;
    void loadRecipients(noRecipients, noRecipients);
    const onFocus = () => {
      if (document.hidden) return;
      const noRecipients = recipientsRef.current.length === 0;
      void loadRecipients(noRecipients, noRecipients);
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);

    const saveData = typeof navigator !== "undefined" && (navigator as any).connection?.saveData;
    const pollMs = isMobileApp ? 3000 : saveData ? 45_000 : 25_000;
    let alive = true;
    let timer: number | null = null;
    const schedule = () => {
      if (!alive) return;
      const jitterMs = Math.floor(pollMs * 0.2);
      const nextMs = pollMs + Math.floor(Math.random() * (jitterMs + 1));
      timer = window.setTimeout(() => {
        if (!alive) return;
        if (!document.hidden) {
          const noRecipients = recipientsRef.current.length === 0;
          void loadRecipients(noRecipients, noRecipients);
        }
        schedule();
      }, nextMs);
    };
    schedule();

    return () => {
      alive = false;
      if (timer !== null) window.clearTimeout(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [isMobileApp, loadRecipients]);

  React.useEffect(() => {
    if (!meId || !selectedId) return;
    setStorageValue(`fxlocus_consult_last_${meId}`, selectedId);
  }, [meId, selectedId, setStorageValue]);

  React.useEffect(() => {
    if (!recipients.length || selectedId) return;
    const fallbackLatest: Record<string, string> = {};
    recipients.forEach((item) => {
      const v = String(item.last_message_at || "").trim();
      if (v) fallbackLatest[item.id] = v;
    });
    const mergedLatest = { ...fallbackLatest, ...(latestByPeer || {}) };
    const entries = Object.entries(mergedLatest);
    if (!entries.length) {
      if (meId) {
        const stored = safeStorageGet(`fxlocus_consult_last_${meId}`);
        if (stored && recipients.some((item) => item.id === stored)) {
          setSelectedId(stored);
          return;
        }
      }
      if (recipients[0]) setSelectedId(recipients[0].id);
      return;
    }
    const sorted = entries
      .filter(([id]) => recipients.some((item) => item.id === id))
      .sort((a, b) => parseTimeToNumber(b[1]) - parseTimeToNumber(a[1]));
    if (sorted.length) {
      setSelectedId(sorted[0][0]);
      return;
    }
    if (recipients[0]) setSelectedId(recipients[0].id);
  }, [latestByPeer, recipients, selectedId, meId]);

  React.useEffect(() => {
    const allowed = new Set(recipients.map((item) => item.id));
    setUnreadByPeer((prev) => {
      const next: Record<string, number> = {};
      for (const [peerId, count] of Object.entries(prev)) {
        if (!allowed.has(peerId)) continue;
        next[peerId] = Number(count || 0);
      }
      return next;
    });
    setLatestByPeer((prev) => {
      const next: Record<string, string> = {};
      for (const [peerId, value] of Object.entries(prev)) {
        if (!allowed.has(peerId)) continue;
        next[peerId] = value;
      }
      return next;
    });
  }, [recipients]);

  React.useEffect(() => {
    if (!selectedId) return;
    if (recipients.some((item) => item.id === selectedId)) return;
    setSelectedId("");
    setMessages([]);
    setReplyTarget(null);
  }, [recipients, selectedId]);

  React.useEffect(() => {
    if (selectedId) return;
    loadUnreadCounts(true);
    const saveData = typeof navigator !== "undefined" && (navigator as any).connection?.saveData;
    const pollMs = isMobileApp ? 650 : saveData ? 30_000 : 20_000;
    let alive = true;
    let timer: number | null = null;
    const schedule = () => {
      if (!alive) return;
      const jitterMs = Math.floor(pollMs * 0.2);
      const nextMs = pollMs + Math.floor(Math.random() * (jitterMs + 1));
      timer = window.setTimeout(() => {
        if (!alive) return;
        if (!document.hidden) loadUnreadCounts(false);
        schedule();
      }, nextMs);
    };
    schedule();
    return () => {
      alive = false;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [isMobileApp, loadUnreadCounts, selectedId]);

  React.useEffect(() => {
    if (!selectedId) return;
    setError("");
    const cachedMessages = readCachedMessages(selectedId);
    setMessages(cachedMessages);
    lastMessageAtRef.current = cachedMessages.length
      ? String(cachedMessages[cachedMessages.length - 1]?.created_at || "") || null
      : null;
    void loadMessages(selectedId, undefined, true).finally(() => loadUnreadCounts(true));
    const saveData = typeof navigator !== "undefined" && (navigator as any).connection?.saveData;
    const pollMs = isMobileApp ? 450 : saveData ? 28_000 : 18_000;
    let alive = true;
    let timer: number | null = null;
    const schedule = () => {
      if (!alive) return;
      const jitterMs = Math.floor(pollMs * 0.2);
      const nextMs = pollMs + Math.floor(Math.random() * (jitterMs + 1));
      timer = window.setTimeout(() => {
        if (!alive) return;
        if (!document.hidden) {
          const since = lastMessageAtRef.current || undefined;
          void loadMessages(selectedId, since).finally(() => loadUnreadCounts(false));
        }
        schedule();
      }, nextMs);
    };
    schedule();
    return () => {
      alive = false;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [isMobileApp, loadMessages, loadUnreadCounts, readCachedMessages, selectedId]);

  useSystemRealtimeRefresh(
    () => {
      if (!meId) return;
      const peerId = selectedRef.current;
      if (peerId) {
        const since = lastMessageAtRef.current || undefined;
        void loadMessages(peerId, since).finally(() => {
          loadUnreadCounts(false);
          loadRecipients(false);
        });
        return;
      }
      loadUnreadCounts(false);
      loadRecipients(false);
    },
    {
      throttleMs: isMobileApp ? 250 : 3000,
      globalThrottleMs: isMobileApp ? 350 : 4000,
      tables: ["consult_messages"],
      dedupeKey: "consult:messages"
    }
  );

  React.useEffect(() => {
    if (!listRef.current) return;
    if (stickToBottomRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
      lastScrollTopRef.current = listRef.current.scrollTop;
    }
  }, [messages, selectedId]);

  React.useEffect(() => {
    stickToBottomRef.current = true;
  }, [selectedId]);

  const filteredRecipients = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = q
      ? recipients.filter((item) => {
        const name = `${item.full_name || ""} ${item.email || ""} ${resolveSupportDisplayName(item)} ${roleLabel(item.role, locale)}`;
        return name.toLowerCase().includes(q);
      })
      : recipients;
    if (!base.length) return base;
    return base
      .map((item, idx) => ({ item, idx }))
      .sort((a, b) => {
        const latestA = parseTimeToNumber(latestByPeer[a.item.id] || a.item.last_message_at || "");
        const latestB = parseTimeToNumber(latestByPeer[b.item.id] || b.item.last_message_at || "");
        if (latestA !== latestB) return latestB - latestA;
        const nameA = (a.item.full_name || a.item.email || "").toLowerCase();
        const nameB = (b.item.full_name || b.item.email || "").toLowerCase();
        const nameCmp = nameA.localeCompare(nameB);
        if (nameCmp !== 0) return nameCmp;
        return a.idx - b.idx;
      })
      .map((row) => row.item);
  }, [query, recipients, locale, latestByPeer]);
  const {
    visibleItems: visibleRecipients,
    visibleCount: visibleRecipientsCount,
    setVisibleCount: setVisibleRecipientsCount,
    hasMore: hasMoreRecipients,
    sentinelRef: recipientsSentinelRef
  } = useProgressiveList(filteredRecipients, {
    initial: contactsCollapsed ? 20 : 28,
    step: contactsCollapsed ? 18 : 20,
    enabled: filteredRecipients.length > (contactsCollapsed ? 24 : 30),
    deps: [query, recipients.length, contactsCollapsed, selectedId],
    rootRef: contactsListRef,
    rootMargin: "120px 0px"
  });

  React.useEffect(() => {
    if (!selectedId) return;
    const index = filteredRecipients.findIndex((item) => item.id === selectedId);
    if (index < 0) return;
    if (index + 1 <= visibleRecipientsCount) return;
    setVisibleRecipientsCount(index + 1);
  }, [filteredRecipients, selectedId, setVisibleRecipientsCount, visibleRecipientsCount]);

  const activeRecipient = React.useMemo(
    () => recipients.find((item) => item.id === selectedId) || null,
    [recipients, selectedId]
  );
  const callPeerId = React.useMemo(() => {
    if (!callSession || !meId) return "";
    return callSession.caller_user_id === meId ? callSession.callee_user_id : callSession.caller_user_id;
  }, [callSession, meId]);
  const callPeer = React.useMemo(
    () => recipients.find((item) => item.id === callPeerId) || null,
    [callPeerId, recipients]
  );

  const cleanupCallResources = React.useCallback((resetState = false) => {
    stopCallRinging();
    callSignalsAfterIdRef.current = 0;
    callOfferSentRef.current = false;
    callIceRestartedRef.current = false;
    pendingRemoteIceCandidatesRef.current = [];
    if (callPeerConnectionRef.current) {
      try {
        callPeerConnectionRef.current.onicecandidate = null;
        callPeerConnectionRef.current.ontrack = null;
        callPeerConnectionRef.current.onconnectionstatechange = null;
        callPeerConnectionRef.current.oniceconnectionstatechange = null;
        callPeerConnectionRef.current.close();
      } catch {
        // ignore
      }
      callPeerConnectionRef.current = null;
    }
    if (callLocalStreamRef.current) {
      callLocalStreamRef.current.getTracks().forEach((track) => track.stop());
      callLocalStreamRef.current = null;
    }
    if (callRemoteAudioRef.current) {
      callRemoteAudioRef.current.pause();
      callRemoteAudioRef.current.srcObject = null;
    }
    if (callAudioFocusActiveRef.current) {
      callAudioFocusActiveRef.current = false;
      void abandonNativeAudioFocus();
    }
    if (resetState) {
      callAcceptingSessionIdRef.current = "";
      callAcceptingSessionUntilRef.current = 0;
      callSessionRef.current = null;
      callDirectionRef.current = null;
      callPhaseRef.current = "idle";
      setCallSession(null);
      setCallDirection(null);
      setCallPhase("idle");
      setCallMuted(false);
      setCallSpeaker(true);
    }
  }, [abandonNativeAudioFocus, stopCallRinging]);

  const postCallSignal = React.useCallback(
    async (sessionId: string, kind: string, payload?: unknown) => {
      const result = await fetchSystemJson<{ ok?: boolean; error?: string }>("/api/system/consult/call/signals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, kind, payload: payload ?? null }),
        dedupeKey: `consult:call-signal:${sessionId}:${kind}:${Date.now()}:${Math.random().toString(36).slice(2)}`,
        skipInflight: true,
        retries: 1,
        retryBaseMs: 200,
        retryMaxMs: 800,
        dedupeWindowMs: 0,
        staleTtlMs: 0
      });
      const json = (result.body || null) as any;
      if (!result.ok || !json?.ok) throw new Error(json?.error || result.errorCode || "call_signal_failed");
    },
    []
  );

  const ensureCallLocalStream = React.useCallback(async () => {
    if (callLocalStreamRef.current && callLocalStreamRef.current.getAudioTracks().some((track) => track.readyState === "live")) {
      return callLocalStreamRef.current;
    }
    let lastError: unknown = null;
    if (!callAudioFocusActiveRef.current) {
      callAudioFocusActiveRef.current = await requestNativeAudioFocus("call");
      if (callAudioFocusActiveRef.current) {
        await waitForMs(180);
      }
    }
    for (const delayMs of [0, 240, 700, 1400]) {
      if (delayMs > 0) await waitForMs(delayMs);
      if (callLocalStreamRef.current) {
        callLocalStreamRef.current.getTracks().forEach((track) => track.stop());
        callLocalStreamRef.current = null;
      }
      try {
        const stream = await openMicrophoneStream();
        callLocalStreamRef.current = stream;
        return stream;
      } catch (err) {
        lastError = err;
      }
    }
    if (callAudioFocusActiveRef.current) {
      callAudioFocusActiveRef.current = false;
      void abandonNativeAudioFocus();
    }
    throw lastError || new Error("MICROPHONE_FAILED");
  }, [abandonNativeAudioFocus, openMicrophoneStream, requestNativeAudioFocus]);

  const ensureCallPeerConnection = React.useCallback(
    async (session: CallSession, isCaller: boolean) => {
      if (callPeerConnectionRef.current) return callPeerConnectionRef.current;
      const stream = await ensureCallLocalStream();
      const connection = new RTCPeerConnection({
        iceServers: buildCallIceServers(),
        iceCandidatePoolSize: 2
      });
      stream.getTracks().forEach((track) => connection.addTrack(track, stream));
      connection.ontrack = (event) => {
        const [remoteStream] = event.streams;
        if (callRemoteAudioRef.current && remoteStream) {
          callRemoteAudioRef.current.srcObject = remoteStream;
          callRemoteAudioRef.current.volume = callSpeaker ? 1 : 0.72;
          void callRemoteAudioRef.current.play().catch(() => {});
        }
      };
      connection.onicecandidate = (event) => {
        if (!event.candidate) return;
        void postCallSignal(session.id, "ice", event.candidate.toJSON()).catch(() => {});
      };
      connection.onconnectionstatechange = () => {
        const state = connection.connectionState;
        if (state === "connected") {
          setCallPhase("active");
          setError("");
        }
        if (state === "connecting") {
          setCallPhase((prev) => (prev === "active" ? prev : "connecting"));
        }
        if (state === "disconnected") {
          setCallPhase((prev) => (prev === "active" ? "connecting" : prev));
        }
        if (state === "failed") {
          setCallPhase("connecting");
          setError(locale === "zh" ? "语音通话正在重连..." : "Reconnecting voice call...");
          if (isCaller && !callIceRestartedRef.current && typeof connection.restartIce === "function") {
            callIceRestartedRef.current = true;
            try {
              connection.restartIce();
              void connection
                .createOffer({ iceRestart: true, offerToReceiveAudio: true })
                .then(async (offer) => {
                  await connection.setLocalDescription(offer);
                  await postCallSignal(session.id, "offer", offer);
                })
                .catch(() => {
                  setError(locale === "zh" ? "语音通话连接失败，请重新发起" : "Voice call connection failed. Please retry.");
                });
            } catch {
              setError(locale === "zh" ? "语音通话连接失败，请重新发起" : "Voice call connection failed. Please retry.");
            }
            return;
          }
          setError(locale === "zh" ? "语音通话连接失败，请重新发起" : "Voice call connection failed. Please retry.");
        }
      };
      connection.oniceconnectionstatechange = () => {
        const state = connection.iceConnectionState;
        if (state === "connected" || state === "completed") {
          setCallPhase("active");
          setError("");
        } else if (state === "checking") {
          setCallPhase((prev) => (prev === "active" ? prev : "connecting"));
        } else if (state === "disconnected") {
          setCallPhase((prev) => (prev === "active" ? "connecting" : prev));
        }
      };
      callPeerConnectionRef.current = connection;
      if (isCaller && !callOfferSentRef.current) {
        const offer = await connection.createOffer({
          offerToReceiveAudio: true
        });
        await connection.setLocalDescription(offer);
        await postCallSignal(session.id, "offer", offer);
        callOfferSentRef.current = true;
        setCallPhase("connecting");
      }
      return connection;
    },
    [callSpeaker, ensureCallLocalStream, locale, postCallSignal]
  );

  const flushPendingRemoteIceCandidates = React.useCallback(async (connection: RTCPeerConnection) => {
    if (!connection.currentRemoteDescription) return;
    const candidates = pendingRemoteIceCandidatesRef.current.splice(0);
    for (const candidate of candidates) {
      try {
        await connection.addIceCandidate(new RTCIceCandidate(candidate));
      } catch {
        // ignore stale or invalid candidates
      }
    }
  }, []);

  const processCallSignal = React.useCallback(
    async (session: CallSession, signal: CallSignal) => {
      const payload = signal.payload ? JSON.parse(signal.payload) : null;
      if (signal.kind === "heartbeat") {
        return;
      }
      if (signal.kind === "accept") {
        setCallSession((prev) =>
          prev?.id === session.id
            ? { ...prev, status: "active", answered_at: prev.answered_at || new Date().toISOString() }
            : { ...session, status: "active" }
        );
        setCallPhase("connecting");
        await ensureCallPeerConnection(session, true);
        return;
      }
      if (signal.kind === "reject" || signal.kind === "end") {
        cleanupCallResources(true);
        return;
      }
      if (signal.kind === "offer") {
        const connection = await ensureCallPeerConnection(session, false);
        if (payload?.type === "offer") {
          if (connection.signalingState !== "stable") {
            try {
              await connection.setLocalDescription({ type: "rollback" } as RTCSessionDescriptionInit);
            } catch {
              // Some WebViews do not support rollback; continue with the new offer when possible.
            }
          }
          await connection.setRemoteDescription(new RTCSessionDescription(payload));
          await flushPendingRemoteIceCandidates(connection);
          const answer = await connection.createAnswer();
          await connection.setLocalDescription(answer);
          await postCallSignal(session.id, "answer", answer);
          setCallPhase("connecting");
        }
        return;
      }
      if (signal.kind === "answer") {
        const connection = callPeerConnectionRef.current;
        if (!connection) return;
        if (payload?.type === "answer" && connection.signalingState === "have-local-offer") {
          await connection.setRemoteDescription(new RTCSessionDescription(payload));
          await flushPendingRemoteIceCandidates(connection);
        }
        setCallPhase("connecting");
        return;
      }
      if (signal.kind === "ice") {
        const connection = callPeerConnectionRef.current;
        if (!connection || !payload) return;
        if (!connection.currentRemoteDescription) {
          pendingRemoteIceCandidatesRef.current.push(payload);
          return;
        }
        try {
          await connection.addIceCandidate(new RTCIceCandidate(payload));
        } catch {
          // ignore invalid remote candidates
        }
      }
    },
    [cleanupCallResources, ensureCallPeerConnection, flushPendingRemoteIceCandidates, postCallSignal]
  );

  const togglePin = React.useCallback((peerId: string) => {
    setPinnedPeers((prev) => {
      const next = new Set(prev);
      if (next.has(peerId)) next.delete(peerId);
      else next.add(peerId);
      return next;
    });
  }, []);

  const markUnread = React.useCallback(
    async (peerId: string) => {
      try {
        const prevUnread = Math.max(0, Number(unreadByPeerRef.current?.[peerId] || 0));
        const result = await fetchSystemJson<{ ok?: boolean; error?: string }>(
          "/api/system/consult/mark-unread",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ peerId }),
            dedupeKey: `consult:mark-unread:${peerId}`,
            retries: 1,
            retryBaseMs: 260,
            retryMaxMs: 1200,
            dedupeWindowMs: 300
          }
        );
        const json = (result.body || null) as any;
        if (!result.ok || !json?.ok) throw new Error(json?.error || result.errorCode || "mark_unread_failed");
        setUnreadByPeer((prev) => ({
          ...prev,
          [peerId]: Math.max(1, prev[peerId] || 0)
        }));
        unreadPrevRef.current = {
          ...unreadPrevRef.current,
          [peerId]: Math.max(1, Number(unreadByPeerRef.current?.[peerId] || 0))
        };
        if (prevUnread <= 0) {
          dispatchSidebarDelta({ consultUnread: 1, holdMs: 1_200 }, "consult_mark_unread");
        }
      } finally {
        loadUnreadCounts(true);
        dispatchSystemRealtime({ table: "consult_messages", action: "update" });
      }
    },
    [loadUnreadCounts]
  );

  const markRead = React.useCallback(
    async (peerId: string) => {
      try {
        const prevUnread = Math.max(0, Number(unreadByPeerRef.current?.[peerId] || 0));
        const result = await fetchSystemJson<{ ok?: boolean; error?: string }>("/api/system/consult/mark-read", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ peerId }),
          dedupeKey: `consult:mark-read:${peerId}`,
          retries: 1,
          retryBaseMs: 260,
          retryMaxMs: 1200,
          dedupeWindowMs: 300
        });
        const json = (result.body || null) as any;
        if (!result.ok || !json?.ok) throw new Error(json?.error || result.errorCode || "mark_read_failed");
        setUnreadByPeer((prev) => ({ ...prev, [peerId]: 0 }));
        unreadPrevRef.current = {
          ...unreadPrevRef.current,
          [peerId]: 0
        };
        if (prevUnread > 0) {
          dispatchSidebarDelta({ consultUnread: -prevUnread, holdMs: 1_200 }, "consult_mark_read");
        }
      } finally {
        loadUnreadCounts(true);
        dispatchSystemRealtime({ table: "consult_messages", action: "update" });
      }
    },
    [loadUnreadCounts]
  );

  React.useEffect(() => {
    if (!contactContextMenu && !messageContextMenu) return;
    const close = (event?: PointerEvent) => {
      if (event && event.button === 2) return;
      setContactContextMenu(null);
      setMessageContextMenu(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [contactContextMenu, messageContextMenu]);

  const totalEmojiPages = Math.max(1, Math.ceil(EMOJIS.length / EMOJI_PAGE_SIZE));
  const pagedEmojis = EMOJIS.slice(
    (emojiPage - 1) * EMOJI_PAGE_SIZE,
    emojiPage * EMOJI_PAGE_SIZE
  );
  const displayEmojis = emojiTab === "recent" ? (recentEmojis.length ? recentEmojis : DEFAULT_RECENTS) : pagedEmojis;

  const pushRecentEmoji = React.useCallback((emoji: string) => {
    setRecentEmojis((prev) => {
      const next = normalizeEmojiList([emoji, ...prev]).slice(0, RECENT_LIMIT);
      safeStorageSet(RECENT_EMOJI_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const send = async (options?: { imageFile?: File | null; audioFile?: File | null; text?: string }) => {
    if (!selectedId) return;
    if (sendingRef.current) return;
    const selectedPeerId = selectedId;
    const selectedImageFile = options?.imageFile !== undefined ? options.imageFile : imageFile;
    const selectedAudioFile = options?.audioFile || null;
    const selectedReplyTarget = replyTarget;
    const rawText = options?.text !== undefined ? options.text : text;
    const payloadText = rawText.trim();
    if (!payloadText && !selectedImageFile && !selectedAudioFile) return;
    sendingRef.current = true;
    setSending(true);
    setError("");
    const optimisticAudioDurationSec = selectedAudioFile ? Math.max(0, Number(lastRecordedDurationSecRef.current || 0)) : 0;
    const optimisticAttachment = selectedImageFile ?? selectedAudioFile ?? null;
    const optimisticImageUrl = optimisticAttachment ? URL.createObjectURL(optimisticAttachment) : null;
    if (optimisticImageUrl) objectUrlRegistryRef.current.add(optimisticImageUrl);
    const optimisticCreatedAt = new Date().toISOString();
    const optimisticMessage: Message = {
      id: `temp:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
      from_user_id: meId,
      to_user_id: selectedPeerId,
      content_type: selectedAudioFile ? "audio" : selectedImageFile ? (payloadText ? "mixed" : "image") : "text",
      content_text: payloadText || null,
      image_url: optimisticImageUrl,
      image_name: selectedAudioFile?.name || selectedImageFile?.name || null,
      image_mime_type: selectedAudioFile?.type || selectedImageFile?.type || null,
      image_size_bytes: selectedAudioFile?.size || selectedImageFile?.size || null,
      reply_to_message_id: selectedReplyTarget?.id || null,
      reply_to: selectedReplyTarget || null,
      created_at: optimisticCreatedAt,
      read_at: null,
      pending: true,
      audio_duration_sec: optimisticAudioDurationSec || null
    };
    if (selectedAudioFile && optimisticAudioDurationSec > 0) {
      const durationKey = buildAudioDurationCacheKey(optimisticMessage);
      if (durationKey) audioDurationCacheRef.current.set(durationKey, optimisticAudioDurationSec);
    }
    stickToBottomRef.current = true;
    lastMessageAtRef.current = optimisticCreatedAt;
    mergeLatestByPeer(selectedPeerId, optimisticCreatedAt);
    setMessages((prev) => {
      const next = [...prev, optimisticMessage];
      rememberMessages(selectedPeerId, next);
      return next;
    });
    setText("");
    setImageFile(null);
    setReplyTarget(null);
    setEmojiOpen(false);
    if (fileRef.current) fileRef.current.value = "";
    try {
      const form = new FormData();
      form.set("requestId", createClientRequestId(`consult_${selectedPeerId}`));
      form.set("toUserId", selectedPeerId);
      if (payloadText) form.set("text", payloadText);
      if (selectedImageFile) form.set("image", selectedImageFile);
      if (selectedAudioFile) {
        form.set("audio", selectedAudioFile);
        if (optimisticAudioDurationSec > 0) {
          form.set("audioDurationSec", String(optimisticAudioDurationSec));
        }
      }
      if (selectedReplyTarget?.id) form.set("replyToMessageId", selectedReplyTarget.id);
      const result = await fetchSystemJson<{ ok?: boolean; error?: string }>("/api/system/consult/send", {
        method: "POST",
        body: form,
        dedupeKey: `consult:send:${selectedPeerId}`,
        timeoutMs: selectedAudioFile ? 60_000 : 12_000,
        retries: selectedAudioFile ? 3 : 1,
        retryBaseMs: 260,
        retryMaxMs: selectedAudioFile ? 3200 : 1200,
        dedupeWindowMs: 300
      });
      const json = (result.body || null) as any;
      if (!result.ok || !json?.ok) throw new Error(json?.error || result.errorCode || "send_failed");
      setMessages((prev) => {
        const next = prev.map((msg) =>
          msg.id === optimisticMessage.id
            ? {
                ...msg,
                pending: false
              }
            : msg
        );
        rememberMessages(selectedPeerId, next);
        return next;
      });
      void loadMessages(selectedPeerId, undefined, true);
      void loadUnreadCounts(true);
      dispatchSystemRealtime({ table: "consult_messages", action: "insert" });
    } catch (e: any) {
      if (optimisticImageUrl) {
        try {
          URL.revokeObjectURL(optimisticImageUrl);
        } catch {
          // ignore
        }
        objectUrlRegistryRef.current.delete(optimisticImageUrl);
      }
      setMessages((prev) => {
        const next = prev.filter((msg) => msg.id !== optimisticMessage.id);
        rememberMessages(selectedPeerId, next);
        return next;
      });
      setText(rawText);
      setImageFile(selectedImageFile);
      setReplyTarget(selectedReplyTarget || null);
      setError(localizeConsultError(e?.message || "send_failed", locale));
    } finally {
      sendingRef.current = false;
      lastRecordedDurationSecRef.current = 0;
      setSending(false);
    }
  };

  const recallMessage = React.useCallback(
    async (messageId: string) => {
      if (!messageId) return;
      setRecallingId(messageId);
      setError("");
      try {
        const result = await fetchSystemJson<{ ok?: boolean; error?: string }>("/api/system/consult/recall", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ messageId }),
          dedupeKey: `consult:recall:${messageId}`,
          retries: 1,
          retryBaseMs: 260,
          retryMaxMs: 1200,
          dedupeWindowMs: 200
        });
        const json = (result.body || null) as any;
        if (!result.ok || !json?.ok) throw new Error(json?.error || result.errorCode || "recall_failed");
        setMessages((prev) => {
          const next = prev.filter((msg) => msg.id !== messageId);
          rememberMessages(selectedRef.current, next);
          return next;
        });
        setReplyTarget((prev) => (prev?.id === messageId ? null : prev));
        await loadUnreadCounts(true);
        dispatchSystemRealtime({ table: "consult_messages", action: "delete" });
      } catch (e: any) {
        setError(e?.message || (locale === "zh" ? "撤回失败" : "Recall failed"));
      } finally {
        setRecallingId(null);
      }
    },
    [loadUnreadCounts, locale, rememberMessages]
  );

  const onSelectRecipient = (id: string) => {
    setError("");
    const prevUnread = Math.max(0, Number(unreadByPeerRef.current?.[id] || 0));
    selectedRef.current = id;
    if (id !== selectedId) {
      const cachedMessages = readCachedMessages(id);
      setMessages(cachedMessages);
      lastMessageAtRef.current = cachedMessages.length
        ? String(cachedMessages[cachedMessages.length - 1]?.created_at || "") || null
        : null;
      setReplyTarget(null);
    }
    setUnreadByPeer((prev) => {
      if (!prev || Number(prev[id] || 0) <= 0) return prev;
      return { ...prev, [id]: 0 };
    });
    unreadPrevRef.current = {
      ...unreadPrevRef.current,
      [id]: 0
    };
    if (prevUnread > 0) {
      dispatchSidebarDelta({ consultUnread: -prevUnread, holdMs: 2500 }, "consult_select_read");
    }
    setContactContextMenu(null);
    setMessageContextMenu(null);
    setSelectedId(id);
    setEmojiOpen(false);
    if (isMobileApp) {
      setMobileChatOpen(true);
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
      });
    }
  };

  const stopRecording = React.useCallback(() => {
    recordHoldActiveRef.current = false;
    recordPointerIdRef.current = null;
    if (recordPressTimerRef.current !== null) {
      window.clearTimeout(recordPressTimerRef.current);
      recordPressTimerRef.current = null;
    }
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      try {
        if (typeof recorder.requestData === "function") {
          recorder.requestData();
        }
      } catch {
        // ignore
      }
      recorder.stop();
    } else {
      recordStartPendingRef.current = false;
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
      setRecordingPreparing(false);
      setRecording(false);
      setRecordingMs(0);
      if (recordTimerRef.current !== null) {
        window.clearInterval(recordTimerRef.current);
        recordTimerRef.current = null;
      }
      if (recordAudioFocusActiveRef.current) {
        recordAudioFocusActiveRef.current = false;
        void abandonNativeAudioFocus();
      }
    }
  }, [abandonNativeAudioFocus]);

  const startRecording = React.useCallback(async () => {
    if (!isMobileApp || sendingRef.current) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError(locale === "zh" ? "当前设备不支持语音录制" : "Voice recording is not supported");
      return;
    }
    try {
      recordStartPendingRef.current = true;
      setRecordingPreparing(true);
      setError("");
      let stream: MediaStream | null = null;
      let lastOpenError: unknown = null;
      if (!recordAudioFocusActiveRef.current) {
        recordAudioFocusActiveRef.current = await requestNativeAudioFocus("recording");
        if (recordAudioFocusActiveRef.current) {
          await waitForMs(180);
        }
      }
      for (const delayMs of [0, 360, 1100]) {
        if (delayMs > 0) await waitForMs(delayMs);
        try {
          stream = await openMicrophoneStream();
          lastOpenError = null;
          break;
        } catch (err) {
          lastOpenError = err;
          if (mediaStreamRef.current) {
            mediaStreamRef.current.getTracks().forEach((track) => track.stop());
            mediaStreamRef.current = null;
          }
        }
      }
      if (lastOpenError || !stream) throw lastOpenError || new Error("MICROPHONE_FAILED");
      if (!recordHoldActiveRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        recordStartPendingRef.current = false;
        setRecordingPreparing(false);
        if (recordAudioFocusActiveRef.current) {
          recordAudioFocusActiveRef.current = false;
          void abandonNativeAudioFocus();
        }
        return;
      }
      mediaStreamRef.current = stream;
      audioChunksRef.current = [];
      const mimeType = pickSupportedRecorderMime();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      recordStartPendingRef.current = false;
      setRecordingPreparing(false);
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };
      recorder.onerror = () => {
        recordStartPendingRef.current = false;
        mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
        mediaRecorderRef.current = null;
        setRecordingPreparing(false);
        setRecording(false);
        setRecordingMs(0);
        if (recordTimerRef.current !== null) {
          window.clearInterval(recordTimerRef.current);
          recordTimerRef.current = null;
        }
        if (recordAudioFocusActiveRef.current) {
          recordAudioFocusActiveRef.current = false;
          void abandonNativeAudioFocus();
        }
        setError(locale === "zh" ? "语音录制失败，请重试" : "Voice recording failed. Please retry.");
      };
      recorder.onstop = () => {
        const chunks = audioChunksRef.current;
        audioChunksRef.current = [];
        mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
        mediaRecorderRef.current = null;
        if (recordTimerRef.current !== null) {
          window.clearInterval(recordTimerRef.current);
          recordTimerRef.current = null;
        }
        if (recordAudioFocusActiveRef.current) {
          recordAudioFocusActiveRef.current = false;
          void abandonNativeAudioFocus();
        }
        const durationMs = Math.min(Date.now() - recordStartedAtRef.current, VOICE_RECORD_MAX_MS);
        setRecording(false);
        setRecordingMs(0);
        if (!chunks.length || durationMs < 500) return;
        lastRecordedDurationSecRef.current = Math.max(0, durationMs / 1000);
        const finalMimeType = mimeType || "audio/webm";
        const ext = finalMimeType.includes("ogg")
          ? "ogg"
          : finalMimeType.includes("mp4") || finalMimeType.includes("m4a")
            ? "m4a"
            : finalMimeType.includes("aac")
              ? "aac"
            : "webm";
        const blob = new Blob(chunks, { type: finalMimeType });
        const file = new File([blob], `voice-${Date.now()}.${ext}`, { type: finalMimeType });
        void send({ audioFile: file, text: "" });
      };
      recorder.start(250);
      recordStartedAtRef.current = Date.now();
      setRecording(true);
      setRecordingMs(0);
      recordTimerRef.current = window.setInterval(() => {
        const elapsed = Date.now() - recordStartedAtRef.current;
        setRecordingMs(Math.min(elapsed, VOICE_RECORD_MAX_MS));
        if (elapsed >= VOICE_RECORD_MAX_MS) {
          stopRecording();
        }
      }, 200);
    } catch (error: any) {
      recordStartPendingRef.current = false;
      setRecordingPreparing(false);
      if (recordAudioFocusActiveRef.current) {
        recordAudioFocusActiveRef.current = false;
        void abandonNativeAudioFocus();
      }
      const normalized = String(error?.message || "").trim().toLowerCase();
      if (normalized === "microphone_in_use") {
        setError(localizeConsultError("microphone_in_use", locale));
      } else if (normalized === "microphone_permission_denied") {
        setError(localizeConsultError("microphone_permission_denied", locale));
      } else {
        setError(locale === "zh" ? "语音录制启动失败" : "Failed to start voice recording");
      }
    }
  }, [abandonNativeAudioFocus, isMobileApp, locale, openMicrophoneStream, requestNativeAudioFocus, send, stopRecording]);

  const queueRecordingStart = React.useCallback(() => {
    recordHoldActiveRef.current = true;
    if (recordPressTimerRef.current !== null) {
      window.clearTimeout(recordPressTimerRef.current);
    }
    recordPressTimerRef.current = window.setTimeout(() => {
      recordPressTimerRef.current = null;
      void startRecording();
    }, 120);
  }, [startRecording]);

  const handleStartVoiceCall = React.useCallback(async () => {
    if (!selectedId) return;
    setError("");
    callStartPendingPeerIdRef.current = selectedId;
    callStartPendingUntilRef.current = Date.now() + 20_000;
    callIgnoredSessionIdRef.current = "";
    callIgnoredSessionUntilRef.current = 0;
    callAcceptingSessionIdRef.current = "";
    callAcceptingSessionUntilRef.current = 0;
    const optimisticSession: CallSession = {
      id: `temp:${Date.now()}`,
      caller_user_id: meId || "me",
      callee_user_id: selectedId,
      status: "pending",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      answered_at: null,
      ended_at: null
    };
    cleanupCallResources(false);
    callSignalsAfterIdRef.current = 0;
    callSessionRef.current = optimisticSession;
    callDirectionRef.current = "outgoing";
    callPhaseRef.current = "ringing";
    setCallSession(optimisticSession);
    setCallDirection("outgoing");
    setCallPhase("ringing");
    setMobileChatOpen(true);

    try {
      const result = await fetchSystemJson<{ ok?: boolean; session?: CallSession; error?: string }>("/api/system/consult/call", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "start", peerId: selectedId }),
        dedupeKey: `consult:call:start:${selectedId}:${Date.now()}`,
        timeoutMs: 12_000,
        retries: 2,
        retryBaseMs: 220,
        retryMaxMs: 1_800,
        dedupeWindowMs: 0,
        skipInflight: true,
        staleTtlMs: 0
      });
      const json = (result.body || null) as any;
      if (!result.ok || !json?.ok || !json?.session) {
        throw new Error(json?.error || result.errorCode || "call_start_failed");
      }
      callStartPendingPeerIdRef.current = "";
      callStartPendingUntilRef.current = 0;
      callSessionRef.current = json.session;
      setCallSession(json.session);
      callPollNowRef.current?.();
      void ensureCallLocalStream()
        .then(() => ensureCallPeerConnection(json.session, true))
        .catch(async () => {
          if (callSessionRef.current?.id !== json.session.id) return;
          cleanupCallResources(true);
          setError(
            locale === "zh"
              ? "无法打开麦克风，请检查应用麦克风权限"
              : "Cannot open microphone. Check app microphone permission."
          );
          try {
            await fetchSystemJson("/api/system/consult/call", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ action: "end", sessionId: json.session.id }),
              dedupeKey: `consult:call:end-after-mic-fail:${json.session.id}`,
              timeoutMs: 2500,
              retries: 0,
              dedupeWindowMs: 0
            });
          } catch {
            // ignore
          }
        });
    } catch {
      callStartPendingPeerIdRef.current = "";
      callStartPendingUntilRef.current = 0;
      cleanupCallResources(true);
      setError(locale === "zh" ? "语音通话启动失败，请稍后重试" : "Failed to start voice call. Please retry.");
    }
  }, [cleanupCallResources, ensureCallLocalStream, ensureCallPeerConnection, locale, meId, selectedId]);

  const handleAcceptVoiceCall = React.useCallback(async () => {
    if (!callSession) return;
    const sessionId = callSession.id;
    const actionSeq = ++callActionSeqRef.current;
    callAcceptingSessionIdRef.current = sessionId;
    callAcceptingSessionUntilRef.current = Date.now() + 25_000;
    callIgnoredSessionIdRef.current = "";
    callIgnoredSessionUntilRef.current = 0;
    setError("");
    setCallPhase("connecting");
    stopCallRinging();
    try {
      await ensureCallLocalStream();
    } catch {
      if (actionSeq !== callActionSeqRef.current || callIgnoredSessionIdRef.current === sessionId) return;
      callAcceptingSessionIdRef.current = "";
      callAcceptingSessionUntilRef.current = 0;
      cleanupCallResources(false);
      setCallSession(callSession);
      setCallDirection("incoming");
      setCallPhase("ringing");
      startCallRinging();
      setError(locale === "zh" ? "无法打开麦克风，请检查应用麦克风权限" : "Cannot open microphone. Check app microphone permission.");
      return;
    }

    const optimisticSession: CallSession = {
      ...callSession,
      status: "active",
      answered_at: callSession.answered_at || new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    callSessionRef.current = optimisticSession;
    callDirectionRef.current = "incoming";
    callPhaseRef.current = "connecting";
    setCallSession(optimisticSession);
    setCallDirection("incoming");
    setCallPhase("connecting");
    void ensureCallPeerConnection(optimisticSession, false).catch(() => {
      setError(locale === "zh" ? "语音通话连接失败，请重新发起" : "Voice call connection failed. Please retry.");
    });

    try {
      const result = await fetchSystemJson<{ ok?: boolean; session?: CallSession; error?: string }>("/api/system/consult/call", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "accept", sessionId }),
        dedupeKey: `consult:call:accept:${sessionId}`,
        timeoutMs: 12_000,
        retries: 2,
        retryBaseMs: 200,
        retryMaxMs: 1600,
        dedupeWindowMs: 0,
        skipInflight: true
      });
      const json = (result.body || null) as any;
      if (!result.ok || !json?.ok || !json?.session) {
        throw new Error(json?.error || result.errorCode || "call_accept_failed");
      }
      if (actionSeq !== callActionSeqRef.current || callIgnoredSessionIdRef.current === sessionId) return;
      callAcceptingSessionIdRef.current = "";
      callAcceptingSessionUntilRef.current = 0;
      callSessionRef.current = json.session;
      callPhaseRef.current = "connecting";
      setCallSession(json.session);
      setCallPhase("connecting");
      callPollNowRef.current?.();
    } catch {
      if (actionSeq !== callActionSeqRef.current || callIgnoredSessionIdRef.current === sessionId) return;
      try {
        const result = await fetchSystemJson<{ ok?: boolean; session?: CallSession | null }>(
          `/api/system/consult/call?sessionId=${encodeURIComponent(sessionId)}`,
          {
            fresh: true,
            dedupeKey: `consult:call:accept-check:${sessionId}`,
            timeoutMs: 2_500,
            retries: 0,
            dedupeWindowMs: 0,
            staleTtlMs: 0,
            preferStale: false,
            revalidateInBackground: false
          }
        );
        const json = (result.body || null) as any;
        if (result.ok && json?.ok && json?.session?.status === "active") {
          callAcceptingSessionIdRef.current = "";
          callAcceptingSessionUntilRef.current = 0;
          callSessionRef.current = json.session;
          callPhaseRef.current = "connecting";
          setCallSession(json.session);
          setCallPhase("connecting");
          return;
        }
      } catch {
        // keep optimistic connecting state; the session poll will reconcile.
      }
      if (callAcceptingSessionIdRef.current === sessionId && callAcceptingSessionUntilRef.current > Date.now()) {
        setCallPhase("connecting");
        setError(locale === "zh" ? "正在接听，等待对方连接..." : "Answering. Waiting for peer connection...");
        return;
      }
      callAcceptingSessionIdRef.current = "";
      callAcceptingSessionUntilRef.current = 0;
      cleanupCallResources(true);
      setError(localizeConsultError("call_accept_failed", locale));
    }
  }, [callSession, cleanupCallResources, ensureCallLocalStream, ensureCallPeerConnection, locale, startCallRinging, stopCallRinging]);

  const handleRejectVoiceCall = React.useCallback(async () => {
    if (!callSession) return;
    ++callActionSeqRef.current;
    const sessionId = callSession.id;
    callIgnoredSessionIdRef.current = sessionId;
    callIgnoredSessionUntilRef.current = Date.now() + 8_000;
    callAcceptingSessionIdRef.current = "";
    callAcceptingSessionUntilRef.current = 0;
    cleanupCallResources(true);
    if (sessionId.startsWith("temp:")) return;
    try {
      await fetchSystemJson("/api/system/consult/call", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "reject", sessionId }),
        dedupeKey: `consult:call:reject:${sessionId}`,
        timeoutMs: 2_500,
        retries: 0,
        retryBaseMs: 200,
        retryMaxMs: 900,
        dedupeWindowMs: 150
      });
    } catch {}
  }, [callSession, cleanupCallResources]);

  const handleEndVoiceCall = React.useCallback(async () => {
    ++callActionSeqRef.current;
    if (!callSession) {
      cleanupCallResources(true);
      return;
    }
    const sessionId = callSession.id;
    callIgnoredSessionIdRef.current = sessionId;
    callIgnoredSessionUntilRef.current = Date.now() + 8_000;
    callAcceptingSessionIdRef.current = "";
    callAcceptingSessionUntilRef.current = 0;
    cleanupCallResources(true);
    if (sessionId.startsWith("temp:")) return;
    try {
      await fetchSystemJson("/api/system/consult/call", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "end", sessionId }),
        dedupeKey: `consult:call:end:${sessionId}`,
        timeoutMs: 2_500,
        retries: 0,
        retryBaseMs: 200,
        retryMaxMs: 900,
        dedupeWindowMs: 150
      });
    } catch {}
  }, [callSession, cleanupCallResources]);

  React.useEffect(() => {
    if (!isMobileApp || !meId) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const currentSelectedId = selectedRef.current;
        const currentCallSession = callSessionRef.current;
        const currentCallDirection = callDirectionRef.current;
        const currentCallPhase = callPhaseRef.current;
        const endpoint = "/api/system/consult/call";
        const result = await fetchSystemJson<{ ok?: boolean; session?: CallSession | null }>(endpoint, {
          fresh: true,
          dedupeKey: `consult:call:session:${currentSelectedId || "any"}`,
          retries: 1,
          retryBaseMs: 200,
          retryMaxMs: 900,
          dedupeWindowMs: 0,
          staleTtlMs: 0,
          preferStale: false,
          revalidateInBackground: false
        });
        const json = (result.body || null) as any;
        if (cancelled || !result.ok || !json?.ok) return;
        const session = (json?.session || null) as CallSession | null;
        const now = Date.now();
        if (
          session &&
          callIgnoredSessionIdRef.current &&
          callIgnoredSessionUntilRef.current > now &&
          session.id === callIgnoredSessionIdRef.current
        ) {
          return;
        }
        if (!session) {
          const waitingForOutgoingSession =
            currentCallDirection === "outgoing" &&
            currentCallSession?.id?.startsWith("temp:") &&
            currentSelectedId &&
            callStartPendingPeerIdRef.current === currentSelectedId &&
            callStartPendingUntilRef.current > now;
          const waitingForCloseAcknowledge =
            Boolean(callIgnoredSessionIdRef.current) && callIgnoredSessionUntilRef.current > now;
          if (waitingForOutgoingSession || waitingForCloseAcknowledge) return;
          if (currentCallSession) cleanupCallResources(true);
          return;
        }
        if (currentSelectedId && callStartPendingPeerIdRef.current === currentSelectedId) {
          callStartPendingPeerIdRef.current = "";
          callStartPendingUntilRef.current = 0;
        }
        callSessionRef.current = session;
        setCallSession(session);
        const incoming = session.callee_user_id === meId;
        callDirectionRef.current = incoming ? "incoming" : "outgoing";
        setCallDirection(incoming ? "incoming" : "outgoing");
        if (incoming) {
          switchMobileAppToConsult();
          setSelectedId((prev) => (prev === session.caller_user_id ? prev : session.caller_user_id));
          setMobileChatOpen(true);
        }
        const acceptingThisSession =
          incoming &&
          callAcceptingSessionIdRef.current === session.id &&
          callAcceptingSessionUntilRef.current > now;
        const locallyConnectingThisSession =
          currentCallSession?.id === session.id && (currentCallPhase === "connecting" || currentCallPhase === "active");
        if (session.status === "pending") {
          if (acceptingThisSession || (incoming && locallyConnectingThisSession)) {
            stopCallRinging();
            callPhaseRef.current = "connecting";
            setCallPhase("connecting");
            return;
          }
          callPhaseRef.current = "ringing";
          setCallPhase("ringing");
          startCallRinging();
        } else if (session.status === "active") {
          if (callAcceptingSessionIdRef.current === session.id) {
            callAcceptingSessionIdRef.current = "";
            callAcceptingSessionUntilRef.current = 0;
          }
          stopCallRinging();
          callPhaseRef.current = callPhaseRef.current === "active" ? "active" : "connecting";
          setCallPhase((prev) => (prev === "active" ? prev : "connecting"));
        } else if (session.status === "ended" || session.status === "rejected" || session.status === "missed") {
          if (session.status === "missed") {
            setError(localizeConsultError("call_missed", locale));
          } else if (session.status === "rejected") {
            setError(localizeConsultError("call_rejected", locale));
          }
          cleanupCallResources(true);
        }
      } catch {
        // ignore transient polling errors
      }
    };
    const pollNow = () => {
      void poll();
    };
    callPollNowRef.current = pollNow;
    pollNow();
    const timer = window.setInterval(() => {
      void poll();
    }, 300);
    return () => {
      cancelled = true;
      if (callPollNowRef.current === pollNow) {
        callPollNowRef.current = null;
      }
      window.clearInterval(timer);
    };
  }, [cleanupCallResources, isMobileApp, locale, meId, startCallRinging, stopCallRinging, switchMobileAppToConsult]);

  React.useEffect(() => {
    if (!isMobileApp || typeof window === "undefined") return;
    const pollNow = () => {
      callPollNowRef.current?.();
    };
    const onVisible = () => {
      if (!document.hidden) pollNow();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", pollNow);
    window.addEventListener("pageshow", pollNow);

    const listeners: Array<{ remove?: () => Promise<void> | void }> = [];
    const appPlugin = getCapacitorPlugin<{
      addListener?: (
        eventName: string,
        listener: (state?: { isActive?: boolean }) => void
      ) => Promise<{ remove?: () => Promise<void> | void }> | { remove?: () => Promise<void> | void };
    }>("App");

    if (appPlugin?.addListener) {
      Promise.resolve(
        appPlugin.addListener("appStateChange", (state) => {
          if (state?.isActive) pollNow();
        })
      )
        .then((listener) => {
          listeners.push(listener);
        })
        .catch(() => {});
      Promise.resolve(appPlugin.addListener("resume", pollNow))
        .then((listener) => {
          listeners.push(listener);
        })
        .catch(() => {});
    }

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", pollNow);
      window.removeEventListener("pageshow", pollNow);
      listeners.forEach((listener) => {
        try {
          void listener.remove?.();
        } catch {
          // ignore
        }
      });
    };
  }, [isMobileApp]);

  React.useEffect(() => {
    if (
      !isMobileApp ||
      !callSession?.id ||
      callSession.id.startsWith("temp:") ||
      callSession.status !== "active" ||
      (callPhase !== "connecting" && callPhase !== "active")
    ) {
      return;
    }
    let cancelled = false;
    const heartbeat = async () => {
      try {
        await fetchSystemJson("/api/system/consult/call", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "heartbeat", sessionId: callSession.id }),
          dedupeKey: `consult:call:heartbeat:${callSession.id}`,
          skipInflight: true,
          retries: 0,
          dedupeWindowMs: 0,
          staleTtlMs: 0,
          preferStale: false,
          revalidateInBackground: false
        });
      } catch {
        // ignore transient heartbeat errors
      }
    };
    void heartbeat();
    const timer = window.setInterval(() => {
      if (!cancelled) void heartbeat();
    }, 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [callPhase, callSession?.id, callSession?.status, isMobileApp]);

  React.useEffect(() => {
    if (!isMobileApp || !callSession?.id || !meId || callSession.id.startsWith("temp:")) return;
    let cancelled = false;
    const pollSignals = async () => {
      try {
        const result = await fetchSystemJson<{ ok?: boolean; signals?: CallSignal[] }>(
          `/api/system/consult/call/signals?sessionId=${encodeURIComponent(callSession.id)}&afterId=${callSignalsAfterIdRef.current}`,
          {
            fresh: true,
            dedupeKey: `consult:call:signals:${callSession.id}`,
            retries: 1,
            retryBaseMs: 180,
            retryMaxMs: 700,
            dedupeWindowMs: 0,
            staleTtlMs: 0,
            preferStale: false,
            revalidateInBackground: false
          }
        );
        const json = (result.body || null) as any;
        if (cancelled || !result.ok || !json?.ok) return;
        const incoming = Array.isArray(json?.signals) ? (json.signals as CallSignal[]) : [];
        for (const signal of incoming) {
          callSignalsAfterIdRef.current = Math.max(callSignalsAfterIdRef.current, Number(signal.id || 0));
          await processCallSignal(callSession, signal);
        }
      } catch {
        // ignore transient polling errors
      }
    };
    void pollSignals();
    const timer = window.setInterval(() => {
      void pollSignals();
    }, 320);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [callSession, isMobileApp, meId, processCallSignal]);

  React.useEffect(() => {
    if (!callLocalStreamRef.current) return;
    callLocalStreamRef.current.getAudioTracks().forEach((track) => {
      track.enabled = !callMuted;
    });
  }, [callMuted]);

  React.useEffect(() => {
    if (!callRemoteAudioRef.current) return;
    callRemoteAudioRef.current.volume = callSpeaker ? 1 : 0.72;
  }, [callSpeaker]);

  React.useEffect(() => {
    if (!callSession || callDirection !== "outgoing" || callSession.status !== "active") return;
    if (callPeerConnectionRef.current || callOfferSentRef.current) return;
    void ensureCallPeerConnection(callSession, true).catch(() => {
      setError(locale === "zh" ? "语音通话连接失败" : "Voice call connection failed");
    });
  }, [callDirection, callSession, ensureCallPeerConnection, locale]);

  const onPickEmoji = (emoji: string) => {
    setText((prev) => `${prev}${emoji}`);
    pushRecentEmoji(emoji);
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (!item.type.startsWith("image/")) continue;
      const file = item.getAsFile();
      if (file) {
        setImageFile(file);
        e.preventDefault();
        break;
      }
    }
  };

  const title = locale === "zh" ? "咨询" : "Consultation";
  const subtitle =
    locale === "zh"
      ? "仅可与可见范围内的团队长、教练、助教、学员或超管沟通。"
      : "Chat only with allowed leaders, coaches, assistants, students, or super admins.";
  const recordingElapsedSec = Math.max(0, Math.floor(recordingMs / 1000));
  const recordingRemainingSec = Math.max(0, Math.ceil((VOICE_RECORD_MAX_MS - recordingMs) / 1000));
  const recordingCountdownActive = recording && recordingRemainingSec <= VOICE_RECORD_COUNTDOWN_MS / 1000;
  const recordingOverlayVisible = recording || recordingPreparing;

  const messageList = (
    <div
      ref={listRef}
      className={[
        "consult-chat-scroll flex-1 min-h-0 overflow-y-auto",
        isMobileApp ? "space-y-3 px-4 py-4 pb-5" : "space-y-3 py-4 pr-1"
      ].join(" ")}
      onScroll={() => {
        const el = listRef.current;
        if (!el) return;
        const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
        if (el.scrollTop < lastScrollTopRef.current - 2) {
          stickToBottomRef.current = false;
        } else if (distance < 80) {
          stickToBottomRef.current = true;
        }
        lastScrollTopRef.current = el.scrollTop;
      }}
    >
      {messages.length === 0 ? (
        <div className={isMobileApp ? "px-3 pt-8 text-center text-sm text-white/46" : "text-xs text-white/50"}>
          {locale === "zh" ? "暂无消息" : "No messages yet"}
        </div>
      ) : null}
      {messages.map((msg) => {
        const mine = msg.from_user_id === meId;
        const emojiOnly = msg.content_text ? isEmojiOnly(msg.content_text) : false;
        const isAudioMessage =
          String(msg.content_type || "").toLowerCase() === "audio" ||
          String(msg.image_mime_type || "").toLowerCase().startsWith("audio/");
        const isUnsupportedOnWeb =
          !isMobileApp && (isAudioMessage || String(msg.content_type || "").toLowerCase() === "call");
        const isImageMessage = !isAudioMessage && Boolean(msg.image_url);
        const createdTs = Date.parse(msg.created_at);
        const canRecall = mine && !msg.pending && Number.isFinite(createdTs) && Date.now() - createdTs <= 5 * 60 * 1000;
        const canCopy =
          !isUnsupportedOnWeb &&
          !(isMobileApp && (isAudioMessage || isImageMessage)) &&
          Boolean((msg.content_text && msg.content_text.trim()) || (!isMobileApp && msg.image_url));
        const copied = copiedId === msg.id;
        const quoteUnavailable =
          Boolean(msg.reply_to_message_id) &&
          !msg.reply_to &&
          (locale === "zh" ? "引用消息不可用" : "Referenced message unavailable");
        const quoteText = msg.reply_to ? quotePreviewText(msg.reply_to, locale) : quoteUnavailable;
        const quoteTargetId = msg.reply_to?.id || msg.reply_to_message_id || "";
        const quoteClickable = Boolean(quoteTargetId && msg.reply_to);
        const focused = focusedMessageId === msg.id;
        return (
          <div key={msg.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
            <div
              ref={(node) => registerMessageNode(msg.id, node)}
              onPointerDown={(event) => {
                if (event.button !== 2) return;
                event.preventDefault();
                event.stopPropagation();
                setContactContextMenu(null);
                setMessageContextMenu({ message: msg, x: event.clientX, y: event.clientY });
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setContactContextMenu(null);
                setMessageContextMenu({ message: msg, x: event.clientX, y: event.clientY });
              }}
              className={[
                "border transition-[border-color,box-shadow,background-color] duration-300",
                isMobileApp
                  ? "max-w-[84%] rounded-[20px] px-4 py-3 text-[15px] shadow-[0_12px_26px_rgba(0,0,0,0.18)]"
                  : "max-w-[70%] rounded-2xl px-4 py-2 text-sm",
                mine
                  ? isMobileApp
                    ? "border-sky-300/26 bg-[#1f6fff] text-white"
                    : "bg-sky-500/18 border-sky-400/34 text-sky-50"
                  : isMobileApp
                    ? "border-white/6 bg-[#151b25] text-white/90"
                    : "bg-white/6 border-white/10 text-white/88",
                focused
                  ? mine
                    ? "border-sky-300/80 shadow-[0_0_0_2px_rgba(125,211,252,0.3)]"
                    : "border-amber-300/75 bg-amber-200/10 shadow-[0_0_0_2px_rgba(252,211,77,0.28)]"
                  : ""
              ].join(" ")}
            >
              {quoteText ? (
                <button
                  type="button"
                  disabled={!quoteClickable}
                  onClick={() => {
                    if (!quoteClickable) return;
                    jumpToMessage(quoteTargetId);
                  }}
                  className={[
                    "mb-2 w-full rounded-xl border border-white/15 bg-black/20 px-3 py-2 text-left text-[11px] text-white/65 transition-colors",
                    quoteClickable ? "cursor-pointer hover:border-sky-300/40 hover:bg-black/30" : "cursor-not-allowed"
                  ].join(" ")}
                  title={
                    quoteClickable
                      ? locale === "zh"
                        ? "点击跳转到原消息"
                        : "Jump to original message"
                      : undefined
                  }
                >
                  <div className="mb-1 text-[10px] uppercase tracking-wide text-white/45">
                    {locale === "zh" ? "引用回复" : "Reply"}
                  </div>
                  <div className="whitespace-pre-wrap break-words">{quoteText}</div>
                </button>
              ) : null}
              {msg.content_text ? (
                <div className={emojiOnly ? "whitespace-pre-wrap text-[42px] leading-[1.1]" : "whitespace-pre-wrap break-words leading-6"}>
                  {msg.content_text}
                </div>
              ) : null}
              {isUnsupportedOnWeb ? (
                <div className="rounded-xl border border-amber-300/20 bg-amber-300/10 px-3 py-2 text-xs text-amber-100/85">
                  {locale === "zh" ? "该消息暂不支持，请在手机端查看。" : "This message is not supported here. Please view it in the mobile app."}
                </div>
              ) : null}
              {!isUnsupportedOnWeb && isAudioMessage && msg.image_url ? (
                <ConsultAudioMessage
                  url={msg.image_url}
                  locale={locale}
                  initialDurationSec={Number(msg.audio_duration_sec || 0)}
                  mine={mine}
                  onDurationResolved={(durationSec) => rememberAudioDuration(msg, durationSec)}
                />
              ) : null}
              {!isUnsupportedOnWeb && isImageMessage ? (
                <ConsultMessageImage
                  url={msg.image_url}
                  name={msg.image_name}
                  mimeType={msg.image_mime_type}
                  locale={locale}
                  onOpen={() =>
                    setPreviewFile({
                      name: msg.image_name || "image",
                      url: msg.image_url,
                      mimeType: msg.image_mime_type
                    })
                  }
                />
              ) : null}
              <div className="mt-2 flex items-center gap-2 text-[11px] text-white/45">
                <span>{formatTime(msg.created_at, locale)}</span>
                {mine ? (
                  <span>
                    {msg.pending
                      ? locale === "zh"
                        ? "发送中"
                        : "Sending"
                      : msg.read_at
                        ? locale === "zh"
                          ? "已读"
                          : "Read"
                        : locale === "zh"
                          ? "未读"
                          : "Unread"}
                  </span>
                ) : null}
                {canCopy ? (
                  <button
                    type="button"
                    onClick={() => copyMessage(msg)}
                    className={[
                      "inline-flex h-6 w-6 items-center justify-center rounded-lg border",
                      mine
                        ? "border-white/12 bg-white/[0.12]"
                        : "border-white/10 bg-white/[0.05]",
                      "text-white/68 hover:text-white/92 hover:bg-white/[0.14]"
                    ].join(" ")}
                    aria-label={
                      copied
                        ? locale === "zh"
                          ? "已复制"
                          : "Copied"
                        : locale === "zh"
                          ? "复制消息"
                          : "Copy message"
                    }
                    title={copied ? (locale === "zh" ? "已复制" : "Copied") : locale === "zh" ? "复制" : "Copy"}
                  >
                    {copied ? <Check className="h-3.5 w-3.5 text-emerald-300" /> : <Copy className="h-3.5 w-3.5" />}
                  </button>
                ) : null}
                {canRecall ? (
                  <button
                    type="button"
                    disabled={recallingId === msg.id}
                    onClick={() => recallMessage(msg.id)}
                    className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-white/70 hover:bg-white/10 disabled:opacity-50"
                  >
                    {locale === "zh" ? "撤回" : "Recall"}
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );

  const composer = (
    <div
        className={
          isMobileApp
          ? "consult-mobile-composer shrink-0 border-t border-white/6 bg-[#0d1118] px-3 pb-[calc(env(safe-area-inset-bottom)+10px)] pt-2"
          : "border-t border-white/10 pt-3"
        }
    >
      {error ? <div className="mb-2 text-xs text-rose-300">{error}</div> : null}
      {replyTarget ? (
        <div className="mb-2 flex items-start gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/70">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] uppercase tracking-wide text-white/45">{locale === "zh" ? "正在回复" : "Replying to"}</div>
            <div className="truncate">{quotePreviewText(replyTarget, locale)}</div>
          </div>
          <button
            type="button"
            onClick={() => setReplyTarget(null)}
            className="rounded-md border border-white/15 bg-white/5 px-2 py-0.5 text-[11px] text-white/70 hover:bg-white/10"
          >
            {locale === "zh" ? "取消" : "Cancel"}
          </button>
        </div>
      ) : null}
      {imageFile ? (
        <div className="mb-2 flex items-center gap-2 text-xs text-white/60">
          <span>
            {locale === "zh" ? "已选择图片：" : "Image selected:"} {imageFile.name}
          </span>
          <button
            type="button"
            onClick={() => {
              setImageFile(null);
              if (fileRef.current) fileRef.current.value = "";
            }}
            className="rounded-lg border border-white/15 bg-white/5 px-2 py-1 text-[11px] text-white/70 hover:bg-white/10"
          >
            {locale === "zh" ? "移除" : "Remove"}
          </button>
        </div>
      ) : null}
      {recording && !isMobileApp ? (
        <div className="mb-2 rounded-xl border border-rose-300/18 bg-rose-400/8 px-3 py-2 text-xs text-rose-100">
          {locale === "zh" ? "正在录音，松开后发送" : "Recording. Release to send"} ·{" "}
          {Math.max(1, Math.floor(recordingMs / 1000))}s
        </div>
      ) : null}
      <div className={isMobileApp ? "flex items-end gap-2" : "flex flex-wrap items-center gap-2"}>
        <button
          type="button"
          onClick={() => setEmojiOpen((prev) => !prev)}
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[16px] border border-white/8 bg-[#141a24] text-white/72 hover:bg-[#19212d]"
          title={locale === "zh" ? "表情" : "Emoji"}
        >
          <Smile className="h-4 w-4" />
        </button>
        <label className="inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-[16px] border border-white/8 bg-[#141a24] text-white/72 hover:bg-[#19212d]">
          <ImageUp className="h-4 w-4" />
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0] || null;
              setImageFile(file);
            }}
          />
        </label>
        {isMobileApp ? (
          <>
            <div className="min-w-0 flex-1">
              {mobileComposerMode === "voice" ? (
                <button
                  type="button"
                  onPointerDown={(event) => {
                    event.preventDefault();
                    recordPointerIdRef.current = event.pointerId;
                    event.currentTarget.setPointerCapture?.(event.pointerId);
                    queueRecordingStart();
                  }}
                  onPointerUp={(event) => {
                    event.preventDefault();
                    if (recordPointerIdRef.current !== null && recordPointerIdRef.current !== event.pointerId) return;
                    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
                      event.currentTarget.releasePointerCapture?.(event.pointerId);
                    }
                    stopRecording();
                  }}
                  onPointerCancel={(event) => {
                    event.preventDefault();
                    if (recordPointerIdRef.current !== null && recordPointerIdRef.current !== event.pointerId) return;
                    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
                      event.currentTarget.releasePointerCapture?.(event.pointerId);
                    }
                    stopRecording();
                  }}
                  onPointerMove={(event) => event.preventDefault()}
                  onContextMenu={(event) => event.preventDefault()}
                  style={{ touchAction: "none" }}
                  className={[
                    "flex h-12 w-full items-center justify-center rounded-[18px] border px-4 text-[15px] font-medium transition",
                    recording
                      ? "border-rose-300/28 bg-rose-500/18 text-rose-100"
                      : "border-white/8 bg-[#141a24] text-white/74"
                  ].join(" ")}
                >
                  {recording
                    ? locale === "zh"
                      ? "松开发送语音"
                      : "Release to send"
                    : locale === "zh"
                      ? "按住发送语音"
                      : "Hold to talk"}
                </button>
              ) : (
                <textarea
                  ref={textareaRef}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onPaste={handlePaste}
                  onKeyDown={(e) => {
                    if (sendingRef.current) {
                      e.preventDefault();
                      return;
                    }
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                  placeholder={locale === "zh" ? "输入消息" : "Message"}
                  rows={1}
                  className="block h-12 w-full resize-none overflow-hidden rounded-[18px] border border-white/8 bg-[#141a24] px-4 py-[13px] text-[15px] leading-5 text-white/90 placeholder:whitespace-nowrap placeholder:text-[14px] placeholder:text-white/26"
                />
              )}
            </div>
            {mobileComposerMode === "text" && (text.trim() || imageFile) ? (
              <button
                type="button"
                disabled={sending || (!text.trim() && !imageFile)}
                onClick={() => {
                  void send();
                }}
                className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-[18px] border border-sky-300/20 bg-[#1f6fff] text-sky-100 disabled:opacity-50"
              >
                <Send className="h-4 w-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setMobileComposerMode((prev) => (prev === "text" ? "voice" : "text"))}
                className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-[18px] border border-white/8 bg-[#141a24] text-white/74"
                title={
                  mobileComposerMode === "text"
                    ? locale === "zh"
                      ? "切换语音"
                      : "Voice mode"
                    : locale === "zh"
                      ? "切换文字"
                      : "Text mode"
                }
              >
                {mobileComposerMode === "text" ? <Mic className="h-4 w-4" /> : <Keyboard className="h-4 w-4" />}
              </button>
            )}
          </>
        ) : (
          <>
            <textarea
              ref={textareaRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onPaste={handlePaste}
              onKeyDown={(e) => {
                if (sendingRef.current) {
                  e.preventDefault();
                  return;
                }
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder={locale === "zh" ? "输入消息..." : "Type a message..."}
              rows={1}
              className="min-w-[200px] flex-1 resize-none border border-white/8 rounded-2xl bg-white/5 px-3 py-2 text-sm leading-6 text-white/88 whitespace-pre-wrap break-words"
            />
            <button
              type="button"
              disabled={sending || (!text.trim() && !imageFile)}
              onClick={() => {
                void send();
              }}
              className="inline-flex shrink-0 items-center justify-center gap-2 rounded-2xl border border-sky-300/20 bg-sky-500/15 px-4 py-2 text-sm text-sky-100 hover:bg-sky-500/20 disabled:opacity-50"
            >
              <Send className="h-4 w-4" />
              {sending ? (locale === "zh" ? "发送中" : "Sending") : locale === "zh" ? "发送" : "Send"}
            </button>
          </>
        )}
      </div>
      {emojiOpen ? (
        <div className="mt-2 rounded-2xl border border-white/10 bg-white/5 p-2">
          <div className="flex flex-wrap items-center gap-2 border-b border-white/10 pb-2 text-xs text-white/70">
            <button
              type="button"
              onClick={() => {
                setEmojiTab("recent");
                setEmojiPage(1);
              }}
              className={[
                "rounded-lg border px-2 py-1",
                emojiTab === "recent" ? "border-sky-400/40 bg-sky-400/10 text-sky-100" : "border-white/10 bg-white/5 text-white/60"
              ].join(" ")}
            >
              {locale === "zh" ? "常用" : "Recent"}
            </button>
            <button
              type="button"
              onClick={() => {
                setEmojiTab("all");
                setEmojiPage(1);
              }}
              className={[
                "rounded-lg border px-2 py-1",
                emojiTab === "all" ? "border-sky-400/40 bg-sky-400/10 text-sky-100" : "border-white/10 bg-white/5 text-white/60"
              ].join(" ")}
            >
              {locale === "zh" ? "全部" : "All"}
            </button>
            {emojiTab === "all" ? (
              <div className="ml-auto flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setEmojiPage((p) => Math.max(1, p - 1))}
                  disabled={emojiPage <= 1}
                  className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 disabled:opacity-40"
                >
                  {locale === "zh" ? "上一页" : "Prev"}
                </button>
                <span className="text-white/60">
                  {emojiPage}/{totalEmojiPages}
                </span>
                <button
                  type="button"
                  onClick={() => setEmojiPage((p) => Math.min(totalEmojiPages, p + 1))}
                  disabled={emojiPage >= totalEmojiPages}
                  className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 disabled:opacity-40"
                >
                  {locale === "zh" ? "下一页" : "Next"}
                </button>
              </div>
            ) : null}
          </div>
          <div className="consult-emoji-grid mt-2 grid grid-cols-8 gap-1">
            {displayEmojis.map((emoji) => (
              <button key={emoji} type="button" onClick={() => onPickEmoji(emoji)} className="h-8 w-8 rounded-lg hover:bg-white/10">
                {emoji}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );

  if (isMobileApp) {
    return (
      <div className="consult-mobile-shell relative flex h-full min-h-0 w-full max-w-none flex-1 flex-col overflow-hidden">
        {!mobileChatOpen ? (
          <section className="consult-mobile-panel flex min-h-0 flex-1 flex-col overflow-hidden rounded-[24px] border border-white/7 bg-[#0b0f15]">
            <div className="border-b border-white/6 px-4 pb-3 pt-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[22px] font-semibold tracking-tight text-white">{title}</div>
                  <div className="mt-1 text-xs leading-5 text-white/38">{subtitle}</div>
                </div>
                <div className="rounded-full border border-white/8 bg-white/[0.03] px-3 py-1 text-[11px] text-white/46">
                  {visibleRecipients.length}
                </div>
              </div>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={locale === "zh" ? "搜索联系人..." : "Search contacts..."}
                className="mt-3 h-11 w-full rounded-[18px] border border-white/8 bg-[#141a24] px-4 text-[15px] text-white/88 placeholder:text-white/28"
              />
            </div>
            <div ref={contactsListRef} className="flex-1 min-h-0 overflow-y-auto px-0 py-0">
              {loadingRecipients ? <div className="px-3 py-6 text-center text-sm text-white/48">{locale === "zh" ? "加载中..." : "Loading..."}</div> : null}
              {!loadingRecipients && filteredRecipients.length === 0 ? (
                <div className="px-3 py-10 text-center text-sm text-white/46">{locale === "zh" ? "暂无可咨询对象" : "No available contacts"}</div>
              ) : null}
              <div className="mx-3 my-3 overflow-hidden rounded-[20px] border border-white/6 bg-[#10151d]">
                {visibleRecipients.map((item) => {
                  const baseLabel = item.full_name || item.email || item.id.slice(0, 6);
                  const supportLabel = supportSuffix(item, locale);
                  const label = `${baseLabel}${supportLabel}`;
                  const unreadCount = unreadByPeer[item.id] || 0;
                  const pinned = pinnedPeers.has(item.id);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onSelectRecipient(item.id)}
                      className="flex w-full items-center gap-3 border-b border-white/6 bg-transparent px-4 py-3 text-left transition hover:bg-white/[0.03] last:border-b-0"
                    >
                      <div className="relative h-12 w-12 shrink-0 rounded-full bg-white/8">
                        {item.avatar_url ? (
                          <img src={item.avatar_url} alt={label} className="h-12 w-12 rounded-full object-cover" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-sm font-medium text-white/78">{label.slice(0, 1)}</div>
                        )}
                        {unreadCount > 0 ? (
                          <span className="absolute -right-1 -top-1 min-w-[18px] rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                            {unreadCount > 99 ? "99+" : unreadCount}
                          </span>
                        ) : null}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <div className="truncate text-[15px] font-semibold text-white">{label}</div>
                          {pinned ? <span className="rounded-full border border-sky-300/18 bg-sky-400/10 px-2 py-0.5 text-[10px] text-sky-100">{locale === "zh" ? "置顶" : "Pin"}</span> : null}
                        </div>
                        <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-white/38">
                          <span className="truncate">{roleLabel(item.role, locale)}</span>
                          <span className="shrink-0">{formatTime(latestByPeer[item.id] || item.last_message_at || "", locale)}</span>
                        </div>
                      </div>
                    </button>
                  );
                })}
                {hasMoreRecipients ? (
                  <div ref={recipientsSentinelRef} className="py-2 text-center text-[11px] text-white/45">
                    {locale === "zh" ? "下拉继续加载..." : "Scroll to load more..."}
                  </div>
                ) : null}
              </div>
            </div>
          </section>
        ) : (
          <section className="consult-mobile-chat grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-[26px] border border-white/8 bg-[#0d1118] shadow-[0_22px_46px_rgba(0,0,0,0.28)]">
            <div className="flex items-center gap-3 border-b border-white/6 px-3 pb-3 pt-3">
              <button
                type="button"
                onClick={() => setMobileChatOpen(false)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-[16px] border border-white/8 bg-[#141a24] text-white/78"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
              <div className="h-10 w-10 rounded-full bg-white/8">
                {activeRecipient?.avatar_url ? (
                  <img src={activeRecipient.avatar_url} alt={activeRecipient.full_name || ""} className="h-10 w-10 rounded-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-sm text-white/72">
                    {(activeRecipient?.full_name || activeRecipient?.email || "--").slice(0, 1)}
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] font-semibold text-white">
                  {activeRecipient?.full_name || activeRecipient?.email || (locale === "zh" ? "请选择" : "Select")}
                </div>
                <div className="text-[11px] text-white/42">{activeRecipient ? roleLabel(activeRecipient.role, locale) : ""}</div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    void handleStartVoiceCall();
                  }}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-[16px] border border-white/8 bg-[#141a24] text-white/74 transition hover:bg-[#19212d]"
                  title={locale === "zh" ? "语音电话" : "Voice call"}
                >
                  <Phone className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setAlertsEnabled((prev) => !prev)}
                  className={[
                    "inline-flex h-10 w-10 items-center justify-center rounded-[16px] border",
                    alertsEnabled ? "border-sky-300/22 bg-sky-400/12 text-sky-100" : "border-white/8 bg-[#141a24] text-white/65"
                  ].join(" ")}
                  title={alertsEnabled ? (locale === "zh" ? "关闭提醒" : "Disable alerts") : locale === "zh" ? "打开提醒" : "Enable alerts"}
                >
                  {alertsEnabled ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
                </button>
              </div>
            </div>
            {messageList}
            {composer}
          </section>
        )}
        {recordingOverlayVisible ? (
          <div className="pointer-events-none absolute inset-0 z-[80] flex items-center justify-center bg-black/56 px-6 backdrop-blur-sm">
            <div className="w-full max-w-[280px] rounded-[28px] border border-white/12 bg-[#101722]/92 p-6 text-center shadow-[0_24px_80px_rgba(0,0,0,0.48)]">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-sky-200/18 bg-sky-400/12 text-sky-100">
                <Mic className="h-7 w-7" />
              </div>
              <div className="mt-4 text-[17px] font-semibold text-white">
                {recordingPreparing ? (locale === "zh" ? "准备录音" : "Preparing") : locale === "zh" ? "正在录音" : "Recording"}
              </div>
              <div className="mt-2 text-[28px] font-semibold tabular-nums text-white">
                {formatAudioDuration(recordingElapsedSec, locale)}
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-sky-300 transition-[width] duration-150"
                  style={{ width: `${Math.min(100, (recordingMs / VOICE_RECORD_MAX_MS) * 100)}%` }}
                />
              </div>
              <div
                className={[
                  "mt-4 rounded-2xl border px-3 py-2 text-[13px]",
                  recordingCountdownActive
                    ? "border-rose-300/28 bg-rose-400/12 text-rose-100"
                    : "border-white/10 bg-white/6 text-white/62"
                ].join(" ")}
              >
                {recordingCountdownActive
                  ? locale === "zh"
                    ? `剩余 ${recordingRemainingSec} 秒，将自动发送`
                    : `${recordingRemainingSec}s left, auto sending`
                  : locale === "zh"
                    ? "松开手指发送，最长 2 分钟"
                    : "Release to send. Max 2 minutes."}
              </div>
            </div>
          </div>
        ) : null}
        {callSession ? (
          <div className="absolute inset-0 z-[90] bg-[#081019]/96 backdrop-blur-xl">
            <div className="flex h-full flex-col items-center justify-between px-6 pb-[calc(env(safe-area-inset-bottom)+28px)] pt-[calc(env(safe-area-inset-top)+34px)] text-center">
              <div className="space-y-3">
                <div className="mx-auto flex h-24 w-24 items-center justify-center rounded-full border border-white/10 bg-white/6 text-3xl font-semibold text-white">
                  {(callPeer?.full_name || callPeer?.email || activeRecipient?.full_name || activeRecipient?.email || "--").slice(0, 1)}
                </div>
                <div>
                  <div className="text-[26px] font-semibold text-white">
                    {callPeer?.full_name || callPeer?.email || activeRecipient?.full_name || activeRecipient?.email || (locale === "zh" ? "语音通话" : "Voice call")}
                  </div>
                  <div className="mt-2 text-sm text-white/58">
                    {callPhase === "ringing"
                      ? callDirection === "incoming"
                        ? locale === "zh"
                          ? "来电"
                          : "Incoming call"
                        : locale === "zh"
                          ? "正在呼叫..."
                          : "Calling..."
                      : callPhase === "active"
                        ? locale === "zh"
                          ? "通话中"
                          : "Connected"
                        : locale === "zh"
                          ? "连接中..."
                          : "Connecting..."}
                  </div>
                </div>
              </div>

              <div className="flex items-end gap-4">
                {callDirection === "incoming" && callPhase === "ringing" ? (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        void handleRejectVoiceCall();
                      }}
                      className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-rose-500 text-white shadow-[0_16px_36px_rgba(244,63,94,0.34)]"
                    >
                      <Phone className="h-6 w-6 rotate-[135deg]" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        void handleAcceptVoiceCall();
                      }}
                      className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500 text-white shadow-[0_16px_36px_rgba(16,185,129,0.34)]"
                    >
                      <Phone className="h-6 w-6" />
                    </button>
                  </>
                ) : (
                  <>
                    <div className="flex flex-col items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setCallMuted((prev) => !prev)}
                        className={[
                          "inline-flex h-14 w-14 items-center justify-center rounded-full border border-white/10 transition",
                          callMuted ? "bg-amber-300/18 text-amber-100" : "bg-white/6 text-white/74"
                        ].join(" ")}
                      >
                        {callMuted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
                      </button>
                      <span className="text-[11px] text-white/58">{locale === "zh" ? "闭麦" : "Mute"}</span>
                    </div>
                    <div className="flex flex-col items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setCallSpeaker((prev) => !prev)}
                        className={[
                          "inline-flex h-14 w-14 items-center justify-center rounded-full border border-white/10 transition",
                          callSpeaker ? "bg-sky-400/16 text-sky-100" : "bg-white/6 text-white/74"
                        ].join(" ")}
                      >
                        {callSpeaker ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}
                      </button>
                      <span className="text-[11px] text-white/58">{locale === "zh" ? "免提" : "Speaker"}</span>
                    </div>
                    <div className="flex flex-col items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          void handleEndVoiceCall();
                        }}
                        className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-rose-500 text-white shadow-[0_16px_36px_rgba(244,63,94,0.34)]"
                      >
                        <Phone className="h-6 w-6 rotate-[135deg]" />
                      </button>
                      <span className="text-[11px] text-white/58">{locale === "zh" ? "挂断" : "End"}</span>
                    </div>
                  </>
                )}
              </div>
              <audio ref={callRemoteAudioRef} playsInline autoPlay />
            </div>
          </div>
        ) : null}
        <PreviewModal file={previewFile} locale={locale} onClose={() => setPreviewFile(null)} />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 w-full max-w-none flex-col gap-6 overflow-hidden">
      <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
        <div className="text-white/90 text-xl font-semibold">{title}</div>
        <div className="mt-2 text-xs text-white/55">{subtitle}</div>
      </div>

      <div
        className={[
          "grid flex-1 min-h-0 gap-6 lg:transition-[grid-template-columns] lg:duration-300 lg:ease-out",
          contactsCollapsed ? "lg:grid-cols-[96px_minmax(0,1fr)]" : "lg:grid-cols-[260px_minmax(0,1fr)]"
        ].join(" ")}
      >
        <aside
          className={[
            "consult-contacts-panel flex min-h-0 flex-col rounded-3xl border border-white/10 bg-white/5 p-4 transition-all duration-300 ease-out",
            contactsCollapsed ? "items-center px-2.5 py-3.5" : "space-y-3",
            contactsMotion === "collapse" ? "consult-contacts-collapse" : "",
            contactsMotion === "expand" ? "consult-contacts-expand" : ""
          ].join(" ")}
        >
          <div className={["flex w-full items-center gap-2", contactsCollapsed ? "justify-center pb-2" : ""].join(" ")}>
            {!contactsCollapsed ? (
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={locale === "zh" ? "搜索联系人..." : "Search contacts..."}
                className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/85"
              />
            ) : null}
            <button
              type="button"
              onClick={() =>
                setContactsCollapsed((prev) => {
                  setContactsMotion(prev ? "expand" : "collapse");
                  return !prev;
                })
              }
              className={[
                "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-white/75 transition-all duration-300 ease-out hover:bg-white/10",
                contactsCollapsed ? "mx-auto translate-x-0" : ""
              ].join(" ")}
              title={contactsCollapsed ? (locale === "zh" ? "展开联系人" : "Expand contacts") : locale === "zh" ? "收起联系人" : "Collapse contacts"}
            >
              {contactsCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
            </button>
          </div>
          {!contactsCollapsed && loadingRecipients ? <div className="text-xs text-white/50">{locale === "zh" ? "加载中..." : "Loading..."}</div> : null}
          {!contactsCollapsed && !loadingRecipients && filteredRecipients.length === 0 ? (
            <div className="text-xs text-white/50">{locale === "zh" ? "暂无可咨询对象" : "No available contacts"}</div>
          ) : null}
          <div
            ref={contactsListRef}
            className={[
              "flex-1 min-h-0 overflow-y-auto transition-all duration-300 ease-out",
              contactsCollapsed ? "flex w-full flex-col items-center gap-2 px-1.5" : "space-y-2 pr-1"
            ].join(" ")}
          >
            {visibleRecipients.map((item) => {
              const baseLabel = item.full_name || item.email || item.id.slice(0, 6);
              const supportLabel = supportSuffix(item, locale);
              const label = `${baseLabel}${supportLabel}`;
              const active = item.id === selectedId;
              const unreadCount = unreadByPeer[item.id] || 0;
              const pinned = pinnedPeers.has(item.id);
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelectRecipient(item.id)}
                  onPointerDown={(event) => {
                    if (event.button !== 2) return;
                    event.preventDefault();
                    event.stopPropagation();
                    setMessageContextMenu(null);
                    setContactContextMenu({ id: item.id, x: event.clientX, y: event.clientY });
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setMessageContextMenu(null);
                    setContactContextMenu({ id: item.id, x: event.clientX, y: event.clientY });
                  }}
                  title={contactsCollapsed ? `${label} · ${roleLabel(item.role, locale)}` : undefined}
                  className={[
                    "w-full rounded-2xl border text-left transition-all duration-300 ease-out",
                    contactsCollapsed ? "mx-auto flex h-[58px] w-[58px] items-center justify-center rounded-[18px] p-0" : "px-3 py-2",
                    active
                      ? "border-sky-400/50 bg-sky-400/10 text-white"
                      : pinned
                        ? "border-amber-400/40 bg-amber-400/10 text-white/80"
                        : "border-white/10 bg-white/5 text-white/75 hover:bg-white/10"
                  ].join(" ")}
                >
                  <div className={["flex items-center", contactsCollapsed ? "justify-center" : "gap-3"].join(" ")}>
                    <div className="relative flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-xs text-white/70">
                      {item.avatar_url ? <img src={item.avatar_url} alt={label} className="h-9 w-9 min-h-[2.25rem] min-w-[2.25rem] rounded-full object-cover" /> : label.slice(0, 1)}
                      {unreadCount > 0 ? <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-rose-500 shadow-[0_0_6px_rgba(244,63,94,0.8)]" /> : null}
                    </div>
                    {!contactsCollapsed ? (
                      <div className="min-w-0">
                        <div className="flex min-w-0 items-center gap-2">
                          <div className="truncate text-sm font-semibold">{label}</div>
                          {pinned ? <span className="shrink-0 rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-[10px] text-amber-100">{locale === "zh" ? "置顶" : "Pin"}</span> : null}
                        </div>
                        <div className="text-xs text-white/50">{roleLabel(item.role, locale)}</div>
                      </div>
                    ) : null}
                  </div>
                </button>
              );
            })}
            {hasMoreRecipients && !contactsCollapsed ? (
              <div ref={recipientsSentinelRef} className="py-2 text-center text-[11px] text-white/45">
                {locale === "zh" ? "下拉继续加载..." : "Scroll to load more..."}
              </div>
            ) : null}
          </div>
        </aside>

        {contactContextMenu ? (
          <div
            className="fixed z-50 min-w-[160px] rounded-2xl border border-white/10 bg-[#0b1222] p-2 shadow-[0_12px_30px_rgba(0,0,0,0.45)]"
            style={{ left: contactContextMenu.x, top: contactContextMenu.y }}
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onContextMenu={(event) => event.preventDefault()}
          >
            <button
              type="button"
              onClick={() => {
                void markUnread(contactContextMenu.id);
                setContactContextMenu(null);
              }}
              className="w-full rounded-xl px-3 py-2 text-left text-xs text-white/80 hover:bg-white/10"
            >
              {locale === "zh" ? "标为未读" : "Mark unread"}
            </button>
            <button
              type="button"
              onClick={() => {
                void markRead(contactContextMenu.id);
                setContactContextMenu(null);
              }}
              className="w-full rounded-xl px-3 py-2 text-left text-xs text-white/80 hover:bg-white/10"
            >
              {locale === "zh" ? "取消未读" : "Mark read"}
            </button>
            <button
              type="button"
              onClick={() => {
                if (pinnedPeers.has(contactContextMenu.id)) return;
                togglePin(contactContextMenu.id);
                setContactContextMenu(null);
              }}
              className={[
                "w-full rounded-xl px-3 py-2 text-left text-xs",
                pinnedPeers.has(contactContextMenu.id) ? "cursor-not-allowed text-white/35" : "text-white/80 hover:bg-white/10"
              ].join(" ")}
            >
              {locale === "zh" ? "置顶" : "Pin"}
            </button>
            <button
              type="button"
              onClick={() => {
                if (!pinnedPeers.has(contactContextMenu.id)) return;
                togglePin(contactContextMenu.id);
                setContactContextMenu(null);
              }}
              className={[
                "w-full rounded-xl px-3 py-2 text-left text-xs",
                pinnedPeers.has(contactContextMenu.id) ? "text-white/80 hover:bg-white/10" : "cursor-not-allowed text-white/35"
              ].join(" ")}
            >
              {locale === "zh" ? "取消置顶" : "Unpin"}
            </button>
          </div>
        ) : null}

        {messageContextMenu ? (
          <div
            className="fixed z-50 min-w-[160px] rounded-2xl border border-white/10 bg-[#0b1222] p-2 shadow-[0_12px_30px_rgba(0,0,0,0.45)]"
            style={{ left: messageContextMenu.x, top: messageContextMenu.y }}
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onContextMenu={(event) => event.preventDefault()}
          >
            <button
              type="button"
              onClick={() => {
                setReplyTarget(messageContextMenu.message);
                setMessageContextMenu(null);
                requestAnimationFrame(() => textareaRef.current?.focus());
              }}
              className="w-full rounded-xl px-3 py-2 text-left text-xs text-white/80 hover:bg-white/10"
            >
              {locale === "zh" ? "引用回复" : "Reply with quote"}
            </button>
          </div>
        ) : null}

        <section className="flex min-h-0 flex-col overflow-hidden rounded-3xl border border-white/10 bg-white/5 p-4">
          <div className="flex flex-wrap items-center gap-3 border-b border-white/10 pb-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-xs text-white/70">
              {activeRecipient?.avatar_url ? <img src={activeRecipient.avatar_url} alt={activeRecipient.full_name || ""} className="h-10 w-10 rounded-full object-cover" /> : (activeRecipient?.full_name || activeRecipient?.email || "--").slice(0, 1)}
            </div>
            <div>
              <div className="text-sm font-semibold text-white">
                {activeRecipient?.full_name || activeRecipient?.email || (locale === "zh" ? "请选择" : "Select")}
              </div>
              <div className="text-xs text-white/50">{activeRecipient ? roleLabel(activeRecipient.role, locale) : ""}</div>
            </div>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setAlertsEnabled((prev) => !prev)}
                className={[
                  "inline-flex h-9 items-center gap-2 rounded-xl border px-3 text-xs",
                  alertsEnabled ? "border-sky-400/40 bg-sky-500/10 text-sky-100" : "border-white/10 bg-white/5 text-white/65"
                ].join(" ")}
                title={alertsEnabled ? (locale === "zh" ? "关闭提醒" : "Disable alerts") : locale === "zh" ? "开启提醒" : "Enable alerts"}
              >
                {alertsEnabled ? <Bell className="h-3.5 w-3.5" /> : <BellOff className="h-3.5 w-3.5" />}
                <span>{alertsEnabled ? (locale === "zh" ? "消息提醒开" : "Alerts on") : locale === "zh" ? "消息提醒关" : "Alerts off"}</span>
              </button>
            </div>
          </div>

          {messageList}
          {composer}
        </section>
      </div>
      <PreviewModal file={previewFile} locale={locale} onClose={() => setPreviewFile(null)} />
    </div>
  );
}
