const WRAP_QUOTE_RE = /^["'`\u2018\u2019\u201c\u201d]+|["'`\u2018\u2019\u201c\u201d]+$/g;
const CONTROL_CHAR_RE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\ufeff]/g;
const DOUBLE_QUOTE_RE = /["\u201c\u201d]+/g;
const HAS_DOUBLE_QUOTE_RE = /["\u201c\u201d]/;
const EMBEDDED_QUOTE_RE = /["'`\u2018\u2019\u201c\u201d]/g;

const KNOWN_STORAGE_PREFIXES = [
  "course-notes",
  "course-summaries",
  "weekly-summaries",
  "classic-trades",
  "trade-logs",
  "trade-strategies",
  "student-documents",
  "consult",
  "ladder",
  "desktop",
  "music"
] as const;

const PREFIX_ALIASES: Array<{ re: RegExp; canonical: string }> = [
  { re: /^course[-_]?sum/i, canonical: "course-summaries" },
  { re: /^coursesummaries/i, canonical: "course-summaries" },
  { re: /^weekly[-_]?sum/i, canonical: "weekly-summaries" },
  { re: /^weeklysummaries/i, canonical: "weekly-summaries" },
  { re: /^classic[-_]?trade/i, canonical: "classic-trades" },
  { re: /^classictrades/i, canonical: "classic-trades" },
  { re: /^trade[-_]?log/i, canonical: "trade-logs" },
  { re: /^tradelogs/i, canonical: "trade-logs" },
  { re: /^trade[-_]?strateg/i, canonical: "trade-strategies" },
  { re: /^tradestrateg/i, canonical: "trade-strategies" },
  { re: /^student[-_]?doc/i, canonical: "student-documents" },
  { re: /^studentdocuments/i, canonical: "student-documents" }
];
const STUDENT_DOC_TYPE_SEGMENTS = new Set([
  "enrollment_form",
  "trial_screenshot",
  "verification_image"
]);
const AUDIO_FILE_RE = /\.(mp3|wav|ogg|m4a|aac)$/i;

function tryDecodeURIComponent(input: string) {
  let value = input;
  for (let i = 0; i < 3; i += 1) {
    try {
      const decoded = decodeURIComponent(value);
      if (decoded === value) break;
      value = decoded;
    } catch {
      break;
    }
  }
  return value;
}

export function normalizeStorageBucket(raw: string | null | undefined) {
  return tryDecodeURIComponent(String(raw || ""))
    .trim()
    .replace(CONTROL_CHAR_RE, "")
    .replace(WRAP_QUOTE_RE, "");
}

export function normalizeStoragePath(raw: string | null | undefined) {
  let value = tryDecodeURIComponent(String(raw || ""));
  if (!value) return "";

  value = value.trim();
  value = value.replace(CONTROL_CHAR_RE, "");
  value = value.replace(WRAP_QUOTE_RE, "");
  value = value.replace(/\\/g, "/");
  value = value.replace(/^\/+/, "");
  value = value.replace(/\/{2,}/g, "/");
  value = value.replace(/\/\s+/g, "/");
  value = value.replace(/\s+\//g, "/");
  value = value.replace(/\u00a0/g, " ");
  value = value.replace(/[;,]+$/g, "");
  value = value.trim();
  return value;
}

function stripEmbeddedQuotes(value: string) {
  return String(value || "").replace(EMBEDDED_QUOTE_RE, "");
}

function expandPrefixAliases(value: string) {
  const normalized = normalizeStoragePath(value);
  if (!normalized) return [] as string[];

  const generated = new Set<string>();
  const lower = normalized.toLowerCase();
  for (const alias of PREFIX_ALIASES) {
    const canonicalPrefix = `${alias.canonical.toLowerCase()}/`;
    if (lower.startsWith(canonicalPrefix) || lower === alias.canonical.toLowerCase()) continue;
    const match = lower.match(alias.re);
    if (!match || match.index !== 0) continue;
    const consumed = match[0].length;
    const rest = normalized.slice(consumed).replace(/^\/+/, "");
    if (!rest) continue;
    generated.add(`${alias.canonical}/${rest}`);
  }
  return Array.from(generated);
}

function extractPathCandidatesFromHttpUrl(raw: string) {
  const input = String(raw || "").trim();
  if (!/^https?:\/\//i.test(input)) return [] as string[];
  try {
    const url = new URL(input);
    const out = new Set<string>();
    const pathname = normalizeStoragePath(tryDecodeURIComponent(url.pathname || "").replace(/^\/+/, ""));
    if (pathname) out.add(pathname);

    const nestedPath = normalizeStoragePath(tryDecodeURIComponent(String(url.searchParams.get("path") || "")));
    if (nestedPath) out.add(nestedPath);

    return Array.from(out);
  } catch {
    return [] as string[];
  }
}

export function buildStoragePathCandidates(raw: string | null | undefined) {
  const normalized = normalizeStoragePath(raw);
  if (!normalized) return [] as string[];
  const isProxyPayload = /^api\/system\/storage\/proxy/i.test(normalized);

  const items = new Set<string>();
  const push = (value: string) => {
    const next = normalizeStoragePath(value);
    if (next) items.add(next);
  };
  const pushWithPrefixFix = (value: string) => {
    push(value);

    const compact = stripEmbeddedQuotes(normalizeStoragePath(value));
    if (!compact) return;
    push(compact);

    const lower = compact.toLowerCase();
    for (const prefix of KNOWN_STORAGE_PREFIXES) {
      if (!lower.startsWith(prefix)) continue;
      if (compact.length <= prefix.length) continue;
      const nextChar = compact[prefix.length];
      if (nextChar !== "/") {
        push(`${prefix}/${compact.slice(prefix.length)}`);
      }
    }

    for (const aliasPath of expandPrefixAliases(compact)) {
      push(aliasPath);
    }

    const parts = compact.split("/").filter(Boolean);
    if (
      parts.length >= 3 &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(parts[0]) &&
      STUDENT_DOC_TYPE_SEGMENTS.has(parts[1].toLowerCase())
    ) {
      push(`student-documents/${compact}`);
    }

    if (parts.length >= 2 && /^\d{4}-\d{2}-\d{2}$/.test(parts[0])) {
      push(`ladder/${compact}`);
    }

    if (parts.length >= 2 && parts[0].toLowerCase() === "consult" && parts[1].toLowerCase() !== "images") {
      push(`consult/images/${parts.slice(1).join("/")}`);
    }

    if (parts.length >= 2 && parts[0].toLowerCase() === "music" && parts[1].toLowerCase() !== "tracks") {
      const relative = parts.slice(1).join("/");
      if (AUDIO_FILE_RE.test(relative)) push(`music/tracks/${relative}`);
    }
  };

  pushWithPrefixFix(normalized);
  if (/^https?:\/\//i.test(normalized)) {
    for (const candidate of extractPathCandidatesFromHttpUrl(normalized)) {
      pushWithPrefixFix(candidate);
    }
  }
  if (HAS_DOUBLE_QUOTE_RE.test(normalized)) {
    pushWithPrefixFix(normalized.replace(DOUBLE_QUOTE_RE, ""));
  }
  if (/%22/i.test(normalized)) {
    pushWithPrefixFix(normalized.replace(/%22/gi, ""));
  }

  if (normalized.includes("path=")) {
    try {
      const query = normalized.includes("?") ? normalized.split("?").slice(1).join("?") : normalized;
      const params = new URLSearchParams(query);
      const nestedPath = params.get("path");
      if (nestedPath) {
        pushWithPrefixFix(nestedPath);
        for (const candidate of extractPathCandidatesFromHttpUrl(nestedPath)) {
          pushWithPrefixFix(candidate);
        }
      }
    } catch {
      // ignore malformed query payload
    }
  }

  if (isProxyPayload) {
    try {
      const parsed = new URL(`https://fxlocus.local/${normalized.replace(/^\/+/, "")}`);
      const nestedPath = parsed.searchParams.get("path");
      if (nestedPath) {
        pushWithPrefixFix(nestedPath);
        for (const candidate of extractPathCandidatesFromHttpUrl(nestedPath)) {
          pushWithPrefixFix(candidate);
        }
      }
    } catch {
      // ignore malformed nested proxy payload
    }
  }

  if (isProxyPayload) {
    items.delete(normalized);
    const compact = stripEmbeddedQuotes(normalized);
    if (compact && compact !== normalized) items.delete(compact);
  }

  return Array.from(items);
}
