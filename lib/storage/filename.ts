import path from "path";

const MIME_EXT_MAP: Record<string, string> = {
  "application/pdf": ".pdf",
  "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.ms-excel": ".xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "application/vnd.ms-powerpoint": ".ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
  "application/zip": ".zip",
  "application/x-zip-compressed": ".zip",
  "text/plain": ".txt",
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/bmp": ".bmp",
  "image/avif": ".avif",
  "image/heic": ".heic",
  "image/heif": ".heif",
  "video/mp4": ".mp4"
};

function safeDecode(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizeFilename(value: string) {
  return String(value || "")
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/[\u0000-\u001f]+/g, "")
    .trim();
}

function extFromMime(mimeType: string | null | undefined) {
  const mime = String(mimeType || "").toLowerCase().trim();
  if (!mime) return "";
  if (MIME_EXT_MAP[mime]) return MIME_EXT_MAP[mime];
  if (mime.startsWith("image/")) {
    const subtype = mime.split("/")[1] || "";
    if (subtype && /^[a-z0-9.+-]+$/i.test(subtype)) return `.${subtype.replace(/^\./, "")}`;
  }
  return "";
}

function filenameFromPath(storagePath: string | null | undefined) {
  const raw = String(storagePath || "").trim();
  if (!raw) return "";
  const noQuery = raw.split("?")[0] || raw;
  const base = path.posix.basename(noQuery);
  return normalizeFilename(safeDecode(base));
}

export function ensureDownloadFilename(
  preferredName: string | null | undefined,
  storagePath: string | null | undefined,
  mimeType?: string | null,
  fallback = "download"
) {
  const preferred = normalizeFilename(String(preferredName || ""));
  const fromPath = filenameFromPath(storagePath);
  const base = preferred || fromPath || normalizeFilename(fallback) || "download";
  if (/\.[a-z0-9]{1,12}$/i.test(base)) return base;

  const pathExt = path.posix.extname(fromPath || "");
  if (pathExt && pathExt.length <= 12) return `${base}${pathExt}`;

  const mimeExt = extFromMime(mimeType);
  if (mimeExt) return `${base}${mimeExt}`;

  return base;
}
