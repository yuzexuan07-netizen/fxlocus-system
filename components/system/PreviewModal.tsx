"use client";

import React from "react";
import { createPortal } from "react-dom";
import { saveWithPicker } from "@/lib/downloads/saveWithPicker";

type PreviewFile = {
  name: string;
  url?: string | null;
  mimeType?: string | null;
};

type PreviewModalProps = {
  file: PreviewFile | null;
  locale: "zh" | "en";
  onClose: () => void;
};

type OfficeLocalPreview =
  | {
      mode: "html";
      label: string;
      html: string;
    }
  | {
      mode: "text";
      label: string;
      text: string;
    };

function previewKind(file: PreviewFile) {
  const name = String(file.name || "").toLowerCase();
  const mime = String(file.mimeType || "").toLowerCase();
  if (
    mime.startsWith("image/") ||
    mime === "image" ||
    mime.includes("image") ||
    /\.(png|jpe?g|gif|webp)$/.test(name)
  ) {
    return "image";
  }
  if (mime.includes("pdf") || name.endsWith(".pdf")) return "pdf";
  if (mime.startsWith("text/") || name.endsWith(".txt")) return "text";
  if (/\.(docx?|xlsx?)$/.test(name)) return "office";
  if (mime.includes("msword") || mime.includes("officedocument") || mime.includes("excel")) return "office";
  return "other";
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

type TouchPoint = {
  clientX: number;
  clientY: number;
};

function getTouchDistance(a: TouchPoint, b: TouchPoint) {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

function getTouchAngle(a: TouchPoint, b: TouchPoint) {
  return (Math.atan2(b.clientY - a.clientY, b.clientX - a.clientX) * 180) / Math.PI;
}

function getTouchCenter(a: TouchPoint, b: TouchPoint) {
  return {
    x: (a.clientX + b.clientX) / 2,
    y: (a.clientY + b.clientY) / 2
  };
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

function withModeJson(url: string) {
  const raw = String(url || "").trim();
  if (!raw) return raw;
  const normalized = stripQueryParam(raw, "mode");
  const separator = normalized.includes("?") ? "&" : "?";
  return `${normalized}${separator}mode=json`;
}

function withModeProxy(url: string) {
  const raw = String(url || "").trim();
  if (!raw) return raw;
  const normalized = stripQueryParam(raw, "mode");
  const separator = normalized.includes("?") ? "&" : "?";
  return `${normalized}${separator}mode=proxy`;
}

function parseMaybeUrl(url: string | null | undefined) {
  const raw = String(url || "").trim();
  if (!raw) return null;
  try {
    return raw.startsWith("/") ? new URL(raw, "https://fxlocus.local") : new URL(raw);
  } catch {
    return null;
  }
}

function isStorageProxyUrl(url: string | null | undefined) {
  const parsed = parseMaybeUrl(url);
  return Boolean(parsed && parsed.pathname === "/api/system/storage/proxy");
}

function isModeJsonResolvableUrl(url: string | null | undefined) {
  const parsed = parseMaybeUrl(url);
  if (!parsed) return false;
  if (!parsed.pathname.startsWith("/api/system/")) return false;
  if (parsed.pathname === "/api/system/storage/proxy") return true;
  return parsed.pathname.endsWith("/download");
}

function officeSubtype(file: PreviewFile): "docx" | "doc" | "xlsx" | "xls" | null {
  const name = String(file.name || "").toLowerCase();
  const mime = String(file.mimeType || "").toLowerCase();

  if (name.endsWith(".docx")) return "docx";
  if (name.endsWith(".doc")) return "doc";
  if (name.endsWith(".xlsx")) return "xlsx";
  if (name.endsWith(".xls")) return "xls";

  if (mime.includes("wordprocessingml.document")) return "docx";
  if (mime.includes("msword")) return "doc";
  if (mime.includes("spreadsheetml.sheet")) return "xlsx";
  if (mime.includes("ms-excel") || mime.includes("excel")) return "xls";

  return null;
}

function sanitizePreviewHtml(raw: string) {
  const value = String(raw || "").trim();
  if (!value) return "";
  if (typeof DOMParser === "undefined") {
    return value;
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(value, "text/html");

  doc.querySelectorAll("script,style,iframe,object,embed,form").forEach((el) => el.remove());

  doc.querySelectorAll("*").forEach((el) => {
    const attrs = Array.from(el.attributes);
    for (const attr of attrs) {
      const name = String(attr.name || "").toLowerCase();
      const attrValue = String(attr.value || "");
      if (name.startsWith("on")) {
        el.removeAttribute(attr.name);
        continue;
      }
      if ((name === "href" || name === "src") && /^\s*javascript:/i.test(attrValue)) {
        el.removeAttribute(attr.name);
      }
    }
  });

  return doc.body.innerHTML;
}

export function PreviewModal({ file, locale, onClose }: PreviewModalProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const dragRef = React.useRef({
    active: false,
    startX: 0,
    startY: 0,
    baseX: 0,
    baseY: 0
  });
  const touchRef = React.useRef<
    | {
        mode: "pan";
        startX: number;
        startY: number;
        baseX: number;
        baseY: number;
      }
    | {
        mode: "pinch";
        startDistance: number;
        startAngle: number;
        startCenterX: number;
        startCenterY: number;
        baseScale: number;
        baseRotation: number;
        baseX: number;
        baseY: number;
      }
    | null
  >(null);
  const [scale, setScale] = React.useState(1);
  const [rotation, setRotation] = React.useState(0);
  const [offset, setOffset] = React.useState({ x: 0, y: 0 });
  const [dragging, setDragging] = React.useState(false);
  const [text, setText] = React.useState("");
  const [loadingText, setLoadingText] = React.useState(false);
  const [textError, setTextError] = React.useState<string | null>(null);
  const [resolvedUrl, setResolvedUrl] = React.useState<string | null>(null);
  const [resolvingUrl, setResolvingUrl] = React.useState(false);
  const [officeError, setOfficeError] = React.useState<string | null>(null);
  const [officePreviewUrl, setOfficePreviewUrl] = React.useState<string | null>(null);
  const [officeLocalPreview, setOfficeLocalPreview] = React.useState<OfficeLocalPreview | null>(null);
  const [isMobileApp, setIsMobileApp] = React.useState(false);
  const [imageCandidateIndex, setImageCandidateIndex] = React.useState(0);

  const kind = file ? previewKind(file) : "other";
  const url = file?.url || null;
  const displayUrl = resolvedUrl || url;
  const downloadUrl = (() => {
    const candidates = [url, displayUrl, kind === "office" ? officePreviewUrl : null]
      .map((item) => String(item || "").trim())
      .filter(Boolean);
    if (!candidates.length) return null;
    for (const candidate of candidates) {
      if (!isModeJsonResolvableUrl(candidate)) continue;
      return withDisposition(candidate, "attachment");
    }
    return candidates[0] || null;
  })();
  const officeIframeUrl = officePreviewUrl
    ? `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(officePreviewUrl)}`
    : null;
  const imageCandidates = React.useMemo(() => {
    if (!file || kind !== "image") return [] as string[];
    const candidates = [displayUrl, url];
    if (isModeJsonResolvableUrl(url)) {
      candidates.unshift(withModeProxy(withDisposition(String(url || ""), "inline")));
    }
    return Array.from(new Set(candidates.map((item) => String(item || "").trim()).filter(Boolean)));
  }, [displayUrl, file, kind, url]);
  const activeImageUrl = imageCandidates[imageCandidateIndex] || null;

  const resetTransform = React.useCallback(() => {
    setScale(1);
    setRotation(0);
    setOffset({ x: 0, y: 0 });
  }, []);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const sync = () => {
      setIsMobileApp(
        document.documentElement.getAttribute("data-mobile-app") === "1" && window.innerWidth <= 767
      );
    };
    sync();
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
  }, []);

  React.useEffect(() => {
    setImageCandidateIndex(0);
  }, [file?.name, file?.url, kind]);

  React.useEffect(() => {
    if (!file) return;
    resetTransform();
    setText("");
    setTextError(null);
    if (previewKind(file) !== "text" || !file.url) {
      setLoadingText(false);
      return;
    }
    const controller = new AbortController();
    setLoadingText(true);
    const sourceUrl = isModeJsonResolvableUrl(file.url)
      ? withModeProxy(withDisposition(file.url, "inline"))
      : file.url;
    fetch(sourceUrl, {
      credentials: "include",
      cache: "no-store",
      signal: controller.signal
    })
      .then((res) => {
        if (!res.ok) throw new Error("preview_failed");
        return res.text();
      })
      .then((data) => setText(data))
      .catch((err) => {
        if (err?.name === "AbortError") return;
        setTextError(locale === "zh" ? "预览失败" : "Preview failed");
      })
      .finally(() => setLoadingText(false));
    return () => controller.abort();
  }, [file, locale, resetTransform]);

  React.useEffect(() => {
    if (!file?.url) {
      setResolvedUrl(null);
      setResolvingUrl(false);
      setOfficeError(null);
      setOfficePreviewUrl(null);
      setOfficeLocalPreview(null);
      return;
    }
    if (kind !== "office") {
      setResolvedUrl(file.url);
      setResolvingUrl(false);
      setOfficeError(null);
      setOfficePreviewUrl(null);
      setOfficeLocalPreview(null);
      return;
    }

    const controller = new AbortController();
    const sourceUrl = String(file.url || "").trim();
    const subtype = officeSubtype(file);
    const proxyUrl = isModeJsonResolvableUrl(sourceUrl)
      ? withModeProxy(withDisposition(sourceUrl, "inline"))
      : null;
    const localPreviewSource = proxyUrl || sourceUrl;
    setResolvedUrl(sourceUrl);
    setOfficeError(null);
    setOfficePreviewUrl(null);
    setOfficeLocalPreview(null);
    if (!sourceUrl) {
      setResolvingUrl(false);
      return () => controller.abort();
    }

    const tryLocalTextPreview = async () => {
      if (!localPreviewSource) return false;
      if (subtype !== "docx" && subtype !== "xlsx" && subtype !== "xls") return false;

      const res = await fetch(localPreviewSource, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
        signal: controller.signal
      });
      if (!res.ok) return false;
      const arrayBuffer = await res.arrayBuffer();
      if (!arrayBuffer.byteLength) return false;

      if (subtype === "docx") {
        const mammothModule = await import("mammoth/mammoth.browser");
        const mammothCandidates: any[] = [
          mammothModule,
          (mammothModule as any)?.default,
          (mammothModule as any)?.default?.default
        ].filter(Boolean);
        const mammothApi =
          mammothCandidates.find((candidate) => typeof candidate?.convertToHtml === "function") ||
          mammothCandidates[0];
        const convertImageFactory =
          mammothApi?.images?.imgElement || mammothApi?.images?.inline || null;
        const converter =
          typeof convertImageFactory === "function"
            ? convertImageFactory((image: any) =>
                image.read("base64").then((base64: string) => ({
                  src: `data:${String(image.contentType || "image/png")};base64,${base64}`
                }))
              )
            : null;
        const convertToHtml =
          typeof mammothApi?.convertToHtml === "function"
            ? mammothApi.convertToHtml.bind(mammothApi)
            : typeof (mammothModule as any)?.convertToHtml === "function"
              ? (mammothModule as any).convertToHtml
              : null;
        if (typeof convertToHtml === "function") {
          const htmlParsed = await convertToHtml(
            { arrayBuffer },
            converter ? { convertImage: converter } : undefined
          );
          const htmlRaw = String(htmlParsed?.value || "").trim();
          const htmlSafe = sanitizePreviewHtml(htmlRaw);
          if (htmlSafe && !controller.signal.aborted) {
            setOfficeLocalPreview({
              mode: "html",
              label: locale === "zh" ? "文档内容预览" : "Document preview",
              html: htmlSafe
            });
            setResolvedUrl(localPreviewSource);
            return true;
          }
        }

        const extractRawText =
          typeof mammothApi?.extractRawText === "function"
            ? mammothApi.extractRawText.bind(mammothApi)
            : typeof (mammothModule as any)?.extractRawText === "function"
              ? (mammothModule as any).extractRawText
              : null;
        if (typeof extractRawText !== "function") return false;
        const textParsed = await extractRawText({ arrayBuffer });
        const textValue = String(textParsed?.value || "").trim();
        if (!textValue || controller.signal.aborted) return false;
        setOfficeLocalPreview({
          mode: "text",
          label: locale === "zh" ? "文档文本预览" : "Document text preview",
          text: textValue
        });
        setResolvedUrl(localPreviewSource);
        return true;
      }

      const XLSX = await import("xlsx");
      const workbook = XLSX.read(arrayBuffer, { type: "array" });
      const sheetName = String(workbook.SheetNames?.[0] || "").trim();
      if (!sheetName) return false;
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) return false;
      const value = String(XLSX.utils.sheet_to_csv(sheet, { blankrows: false }) || "").trim();
      if (!value || controller.signal.aborted) return false;
      setOfficeLocalPreview({
        mode: "text",
        label: locale === "zh" ? `表格预览：${sheetName}` : `Sheet preview: ${sheetName}`,
        text: value
      });
      setResolvedUrl(localPreviewSource);
      return true;
    };

    const fetchSigned = async () => {
      const signedProbe = withModeJson(withDisposition(sourceUrl, "inline"));
      const res = await fetch(signedProbe, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
        signal: controller.signal
      });
      const data = await res.json().catch(() => null);
      const signedUrl = String(data?.url || "").trim();
      if (!res.ok || !data?.ok || !signedUrl) throw new Error(String(data?.error || "SIGNED_URL_FAILED"));
      return signedUrl;
    };

    setResolvingUrl(true);
    void (async () => {
      try {
        const localReady = await tryLocalTextPreview().catch(() => false);
        if (controller.signal.aborted) return;
        if (localReady) return;

        if (!isModeJsonResolvableUrl(sourceUrl)) {
          setResolvedUrl(sourceUrl);
          setOfficePreviewUrl(sourceUrl);
          return;
        }

        const signedUrl = await fetchSigned();
        if (controller.signal.aborted) return;
        setResolvedUrl(signedUrl);
        setOfficePreviewUrl(signedUrl);
      } catch (err: any) {
        if (controller.signal.aborted || err?.name === "AbortError") return;
        setOfficePreviewUrl(null);
        setOfficeError(
          locale === "zh" ? "无法在线预览，请点击“下载文件”。" : "Inline preview unavailable. Use Download file."
        );
      } finally {
        if (!controller.signal.aborted) setResolvingUrl(false);
      }
    })();

    return () => controller.abort();
  }, [file, kind, locale]);

  const handleOfficeIframeError = React.useCallback(() => {
    setOfficeError(
      locale === "zh" ? "无法在线预览，请点击“下载文件”。" : "Inline preview unavailable. Use Download file."
    );
  }, [locale]);

  if (!file) return null;

  const handleTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    if (kind !== "image") return;
    if (event.touches.length >= 2) {
      const [first, second] = [event.touches[0], event.touches[1]];
      const center = getTouchCenter(first, second);
      touchRef.current = {
        mode: "pinch",
        startDistance: getTouchDistance(first, second),
        startAngle: getTouchAngle(first, second),
        startCenterX: center.x,
        startCenterY: center.y,
        baseScale: scale,
        baseRotation: rotation,
        baseX: offset.x,
        baseY: offset.y
      };
      return;
    }
    if (event.touches.length === 1) {
      const touch = event.touches[0];
      touchRef.current = {
        mode: "pan",
        startX: touch.clientX,
        startY: touch.clientY,
        baseX: offset.x,
        baseY: offset.y
      };
    }
  };

  const handleTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    if (kind !== "image" || !touchRef.current) return;
    if (touchRef.current.mode === "pinch" && event.touches.length >= 2) {
      event.preventDefault();
      const [first, second] = [event.touches[0], event.touches[1]];
      const distance = getTouchDistance(first, second);
      const angle = getTouchAngle(first, second);
      const center = getTouchCenter(first, second);
      const nextScale = clamp(
        touchRef.current.baseScale * (distance / Math.max(touchRef.current.startDistance, 1)),
        0.6,
        6
      );
      setScale(nextScale);
      setRotation(touchRef.current.baseRotation + (angle - touchRef.current.startAngle));
      setOffset({
        x: touchRef.current.baseX + (center.x - touchRef.current.startCenterX),
        y: touchRef.current.baseY + (center.y - touchRef.current.startCenterY)
      });
      return;
    }
    if (touchRef.current.mode === "pan" && event.touches.length === 1) {
      const touch = event.touches[0];
      setOffset({
        x: touchRef.current.baseX + (touch.clientX - touchRef.current.startX),
        y: touchRef.current.baseY + (touch.clientY - touchRef.current.startY)
      });
    }
  };

  const handleTouchEnd = (event: React.TouchEvent<HTMLDivElement>) => {
    if (kind !== "image") return;
    if (event.touches.length >= 2) {
      const [first, second] = [event.touches[0], event.touches[1]];
      const center = getTouchCenter(first, second);
      touchRef.current = {
        mode: "pinch",
        startDistance: getTouchDistance(first, second),
        startAngle: getTouchAngle(first, second),
        startCenterX: center.x,
        startCenterY: center.y,
        baseScale: scale,
        baseRotation: rotation,
        baseX: offset.x,
        baseY: offset.y
      };
      return;
    }
    if (event.touches.length === 1) {
      const touch = event.touches[0];
      touchRef.current = {
        mode: "pan",
        startX: touch.clientX,
        startY: touch.clientY,
        baseX: offset.x,
        baseY: offset.y
      };
      return;
    }
    touchRef.current = null;
  };

  if (isMobileApp && kind === "image") {
    const mobileModal = (
      <div
        className="fixed inset-0 z-[260] flex items-center justify-center bg-black/88 p-4"
        role="dialog"
        onClick={onClose}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute z-[261] inline-flex h-14 w-14 items-center justify-center rounded-full border border-white/40 bg-black/82 text-[30px] font-light leading-none text-white shadow-[0_14px_32px_rgba(0,0,0,0.52)] backdrop-blur-md"
          aria-label={locale === "zh" ? "关闭预览" : "Close preview"}
          style={{
            top: "calc(env(safe-area-inset-top) + 14px)",
            right: "calc(env(safe-area-inset-right) + 14px)"
          }}
        >
          ×
        </button>
        <div className="flex h-full w-full items-center justify-center" onClick={(event) => event.stopPropagation()}>
          <div
            className="flex h-full w-full items-center justify-center overflow-hidden"
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onTouchCancel={handleTouchEnd}
          >
            {activeImageUrl ? (
              <img
                src={activeImageUrl}
                alt={file.name}
                className="max-h-full max-w-full rounded-2xl object-contain select-none"
                onError={() => {
                  setImageCandidateIndex((prev) => {
                    if (prev + 1 < imageCandidates.length) return prev + 1;
                    return prev;
                  });
                }}
                draggable={false}
                style={{
                  transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale}) rotate(${rotation}deg)`,
                  transition: "transform 100ms ease-out"
                }}
              />
            ) : (
              <div className="text-center text-sm text-white/68">
                {locale === "zh" ? "图片暂时无法显示" : "Image unavailable"}
              </div>
            )}
          </div>
        </div>
      </div>
    );
    if (typeof document === "undefined") return mobileModal;
    return createPortal(mobileModal, document.body);
  }

  const handleFullScreen = () => {
    if (!containerRef.current?.requestFullscreen) return;
    void containerRef.current.requestFullscreen().catch(() => {});
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (kind !== "image") return;
    dragRef.current = {
      active: true,
      startX: event.clientX,
      startY: event.clientY,
      baseX: offset.x,
      baseY: offset.y
    };
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (kind !== "image" || !dragRef.current.active) return;
    const dx = event.clientX - dragRef.current.startX;
    const dy = event.clientY - dragRef.current.startY;
    setOffset({ x: dragRef.current.baseX + dx, y: dragRef.current.baseY + dy });
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (kind !== "image") return;
    dragRef.current.active = false;
    setDragging(false);
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // ignore
    }
  };

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (kind !== "image") return;
    event.preventDefault();
    const step = event.deltaY > 0 ? -0.12 : 0.12;
    setScale((s) => clamp(s + step, 0.4, 4));
  };

  const zoomIn = () => setScale((s) => clamp(s + 0.15, 0.4, 4));
  const zoomOut = () => setScale((s) => clamp(s - 0.15, 0.4, 4));
  const rotateLeft = () => setRotation((r) => (r - 90) % 360);
  const rotateRight = () => setRotation((r) => (r + 90) % 360);

  const desktopModal = (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog">
      <div ref={containerRef} className="w-full max-w-[1000px] rounded-3xl border border-white/10 bg-[#050a14] p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-white/85 font-semibold">
            {locale === "zh" ? "预览" : "Preview"} · {file.name}
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {kind === "image" ? (
              <>
                <button
                  type="button"
                  onClick={zoomOut}
                  className="px-2.5 py-1 rounded-lg border border-white/10 bg-white/5 text-xs text-white/80 hover:bg-white/10"
                >
                  {locale === "zh" ? "缩小" : "Zoom out"}
                </button>
                <button
                  type="button"
                  onClick={zoomIn}
                  className="px-2.5 py-1 rounded-lg border border-white/10 bg-white/5 text-xs text-white/80 hover:bg-white/10"
                >
                  {locale === "zh" ? "放大" : "Zoom in"}
                </button>
                <button
                  type="button"
                  onClick={rotateLeft}
                  className="px-2.5 py-1 rounded-lg border border-white/10 bg-white/5 text-xs text-white/80 hover:bg-white/10"
                >
                  {locale === "zh" ? "左转" : "Rotate left"}
                </button>
                <button
                  type="button"
                  onClick={rotateRight}
                  className="px-2.5 py-1 rounded-lg border border-white/10 bg-white/5 text-xs text-white/80 hover:bg-white/10"
                >
                  {locale === "zh" ? "右转" : "Rotate right"}
                </button>
                <button
                  type="button"
                  onClick={resetTransform}
                  className="px-2.5 py-1 rounded-lg border border-white/10 bg-white/5 text-xs text-white/80 hover:bg-white/10"
                >
                  {locale === "zh" ? "重置" : "Reset"}
                </button>
              </>
            ) : null}
            {displayUrl ? (
              <button
                type="button"
                onClick={handleFullScreen}
                className="px-2.5 py-1 rounded-lg border border-white/10 bg-white/5 text-xs text-white/80 hover:bg-white/10"
              >
                {locale === "zh" ? "全屏" : "Full screen"}
              </button>
            ) : null}
            {downloadUrl ? (
              <button
                type="button"
                onClick={() => {
                  if (!downloadUrl) return;
                  void saveWithPicker({
                    url: downloadUrl,
                    filename: file.name || "download",
                    mimeType: file.mimeType || undefined
                  });
                }}
                className="px-2.5 py-1 rounded-lg border border-white/10 bg-white/5 text-xs text-white/80 hover:bg-white/10"
              >
                {locale === "zh" ? "下载文件" : "Download"}
              </button>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              className="px-2.5 py-1 rounded-lg border border-white/10 bg-white/5 text-xs text-white/80 hover:bg-white/10"
            >
              {locale === "zh" ? "关闭" : "Close"}
            </button>
          </div>
        </div>

        <div
          className="mt-4 h-[72vh] w-full rounded-2xl border border-white/10 bg-black/40 overflow-hidden"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          onWheel={handleWheel}
          style={{ touchAction: kind === "image" ? "none" : "auto" }}
        >
          {displayUrl ? (
            kind === "image" ? (
              <div className="h-full w-full flex items-center justify-center">
                <img
                  src={activeImageUrl || displayUrl || ""}
                  alt={file.name}
                  className="max-h-full max-w-full select-none"
                  draggable={false}
                  onError={() => {
                    setImageCandidateIndex((prev) => {
                      if (prev + 1 < imageCandidates.length) return prev + 1;
                      return prev;
                    });
                  }}
                  style={{
                    transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale}) rotate(${rotation}deg)`,
                    transition: dragging ? "none" : "transform 120ms ease-out"
                  }}
                />
              </div>
            ) : kind === "pdf" ? (
              <iframe title={file.name} src={displayUrl} className="h-full w-full" allowFullScreen />
            ) : kind === "text" ? (
              <div className="h-full w-full overflow-auto p-4 text-sm text-white/80 whitespace-pre-wrap">
                {loadingText
                  ? locale === "zh"
                    ? "加载中..."
                    : "Loading..."
                  : textError
                    ? textError
                    : text || (locale === "zh" ? "暂无内容" : "Empty")}
              </div>
            ) : kind === "office" ? (
              <div className="h-full w-full flex flex-col text-white/70 text-sm gap-3 px-6 py-4">
                {resolvingUrl ? (
                  <div className="h-full w-full flex items-center justify-center text-center">
                    {locale === "zh" ? "正在准备文件..." : "Preparing file..."}
                  </div>
                ) : officeLocalPreview ? (
                  officeLocalPreview.mode === "html" ? (
                    <div className="h-full w-full overflow-auto rounded-xl border border-white/10 bg-white p-4 text-left">
                      <div className="mb-2 text-xs text-slate-500">{officeLocalPreview.label}</div>
                      <div
                        className="summary-preview break-words text-sm leading-7 text-slate-900"
                        dangerouslySetInnerHTML={{ __html: officeLocalPreview.html }}
                      />
                    </div>
                  ) : (
                    <div className="h-full w-full overflow-auto rounded-xl border border-slate-200 bg-white p-4 text-left">
                      <div className="mb-2 text-xs text-slate-500">{officeLocalPreview.label}</div>
                      <div className="mb-3 text-xs text-slate-400">
                        {locale === "zh"
                          ? "当前为文本回退预览，原文档中的图片请点击“下载文件”查看。"
                          : "Text fallback preview. Use Download file to view original embedded images."}
                      </div>
                      <pre className="whitespace-pre-wrap break-words text-xs leading-6 text-slate-800">
                        {officeLocalPreview.text}
                      </pre>
                    </div>
                  )
                ) : officeIframeUrl ? (
                  <iframe
                    title={file.name}
                    src={officeIframeUrl}
                    className="h-full w-full"
                    onError={handleOfficeIframeError}
                    allowFullScreen
                  />
                ) : (
                  <div className="h-full w-full flex items-center justify-center text-center">
                    {officeError ||
                      (locale === "zh"
                        ? "该文档不支持在线预览，请点击“下载文件”查看。"
                        : "This document cannot be previewed inline. Use Download file.")}
                  </div>
                )}
              </div>
            ) : (
              <div className="h-full w-full flex flex-col items-center justify-center text-white/70 text-sm gap-3">
                <div>{locale === "zh" ? "当前格式暂不支持预览" : "Preview not available for this file type."}</div>
                <a
                  href={displayUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="px-3 py-1.5 rounded-xl bg-white/10 border border-white/20 text-white hover:bg-white/15"
                >
                  {locale === "zh" ? "打开文件" : "Open file"}
                </a>
              </div>
            )
          ) : (
            <div className="h-full w-full flex items-center justify-center text-white/60 text-sm">
              {locale === "zh" ? "无法预览该文件" : "Cannot preview this file."}
            </div>
          )}
        </div>
      </div>
    </div>
  );
  if (typeof document === "undefined") return desktopModal;
  return createPortal(desktopModal, document.body);
}
