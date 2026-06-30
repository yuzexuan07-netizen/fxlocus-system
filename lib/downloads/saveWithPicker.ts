"use client";

type SaveOptions = {
  url: string;
  filename: string;
  mimeType?: string | null;
};

function sanitizeFilename(value: string) {
  return value.replace(/[\\/:*?"<>|]+/g, "-").trim();
}

function buildSafeFilename(name: string) {
  const trimmed = sanitizeFilename(name || "download");
  return trimmed || "download";
}

function appendQuery(url: string, key: string, value: string) {
  const separator = url.includes("?") ? "&" : "?";
  if (new RegExp(`[?&]${key}=`).test(url)) return url;
  return `${url}${separator}${key}=${encodeURIComponent(value)}`;
}

function upsertQuery(url: string, key: string, value: string) {
  try {
    const base = typeof window !== "undefined" ? window.location.origin : "https://fxlocus.local";
    const parsed = new URL(url, base);
    parsed.searchParams.set(key, value);
    if (/^https?:\/\//i.test(url)) return parsed.toString();
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return appendQuery(url, key, value);
  }
}

function withDownloadMode(url: string) {
  let next = upsertQuery(url, "mode", "proxy");
  next = upsertQuery(next, "disposition", "attachment");
  return next;
}

function withJsonMode(url: string) {
  return upsertQuery(url, "mode", "json");
}

async function followJsonDownloadResponse(res: Response) {
  let current = res;
  for (let i = 0; i < 2; i += 1) {
    const contentType = String(current.headers.get("content-type") || "").toLowerCase();
    if (!contentType.includes("application/json")) return current;
    const payload = await current.json().catch(() => null);
    const directUrl = String(payload?.url || "").trim();
    if (!directUrl) return current;
    current = await fetch(directUrl, { redirect: "follow" });
  }
  return current;
}

async function saveViaPicker(options: SaveOptions) {
  const safeName = buildSafeFilename(options.filename);
  const picker = (window as any).showSaveFilePicker;
  if (typeof picker !== "function") return false;

  try {
    const handle = await picker({
      suggestedName: safeName
    });
    const sameOriginApi = /^\/api\/system\//.test(options.url);
    const targetUrl = sameOriginApi ? withDownloadMode(options.url) : options.url;
    let res = await followJsonDownloadResponse(await fetch(targetUrl, { redirect: "follow" }));
    if (!res.ok) throw new Error("download_failed");
    let buffer = await res.arrayBuffer();
    if (!buffer.byteLength && sameOriginApi) {
      const retry = await followJsonDownloadResponse(await fetch(withJsonMode(options.url), { redirect: "follow" }));
      if (retry.ok) {
        const retriedBuffer = await retry.arrayBuffer();
        if (retriedBuffer.byteLength) buffer = retriedBuffer;
      }
    }
    if (!buffer.byteLength) throw new Error("empty_download");
    let writable: FileSystemWritableFileStream;
    try {
      writable = await handle.createWritable({ keepExistingData: false });
    } catch {
      writable = await handle.createWritable();
    }
    await writable.write(buffer);
    await writable.close();
    return true;
  } catch (err: any) {
    if (err?.name === "AbortError") return true;
    return false;
  }
}

function saveViaAnchor(options: SaveOptions) {
  const safeName = buildSafeFilename(options.filename);
  const sameOriginApi = /^\/api\/system\//.test(options.url);
  const targetUrl = sameOriginApi ? withDownloadMode(options.url) : options.url;

  const triggerAnchor = (href: string) => {
    const link = document.createElement("a");
    link.href = href;
    link.download = safeName;
    link.rel = "noreferrer";
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  return fetch(targetUrl, { redirect: "follow" })
    .then(async (res) => {
      res = await followJsonDownloadResponse(res);
      if (!res.ok) throw new Error("download_failed");
      let blob = await res.blob();
      if (!blob.size && sameOriginApi) {
        const retry = await followJsonDownloadResponse(await fetch(withJsonMode(options.url), { redirect: "follow" }));
        if (retry.ok) {
          const retriedBlob = await retry.blob();
          if (retriedBlob.size) blob = retriedBlob;
        }
      }
      if (!blob.size) throw new Error("empty_download");
      const objectUrl = URL.createObjectURL(blob);
      try {
        triggerAnchor(objectUrl);
      } finally {
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      }
    })
    .catch(() => {
      // Last-resort fallback for restrictive browsers.
      const legacyUrl = sameOriginApi ? appendQuery(options.url, "disposition", "attachment") : options.url;
      triggerAnchor(legacyUrl);
    });
}

export async function saveWithPicker(options: SaveOptions) {
  if (typeof window === "undefined") return;
  const usedPicker = await saveViaPicker(options);
  if (!usedPicker) await saveViaAnchor(options);
}
