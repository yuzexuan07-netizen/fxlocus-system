"use client";

/* eslint-disable @next/next/no-img-element */

import React from "react";
import { UploadCloud } from "lucide-react";

import { ClientDateTime } from "@/components/system/ClientDateTime";
import { fetchSystemJson } from "@/lib/system/clientFetch";
import { createClientRequestId } from "@/lib/system/clientRequestId";
import { useSystemRealtimeRefresh } from "@/lib/system/useSystemRealtimeRefresh";
import { PreviewModal } from "@/components/system/PreviewModal";
import { PaginationControls } from "@/components/ui/PaginationControls";
import { usePagination } from "@/components/ui/usePagination";

type SummaryKey = "strategy" | "curve" | "stats";
type Locale = "zh" | "en";
type FieldTexts = Record<SummaryKey, string>;
type AssetLabel = { zh: string; en: string };

type WeeklySummaryItem = {
  id: string;
  student_name: string;
  summary_text: string;
  review_note?: string | null;
  reviewed_at?: string | null;
  created_at?: string | null;
  strategy_text?: string | null;
  strategy_url?: string | null;
  strategy_name?: string | null;
  strategy_mime_type?: string | null;
  curve_text?: string | null;
  curve_url?: string | null;
  curve_name?: string | null;
  curve_mime_type?: string | null;
  stats_text?: string | null;
  stats_url?: string | null;
  stats_name?: string | null;
  stats_mime_type?: string | null;
};

type PresignedUpload = {
  key: SummaryKey;
  bucket: string;
  path: string;
  uploadUrl?: string | null;
  fileName?: string | null;
};

const FIELD_KEYS: SummaryKey[] = ["strategy", "curve", "stats"];
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "gif", "bmp", "avif", "heic", "heif", "jfif"]);
const IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
  "image/bmp",
  "image/avif",
  "image/heic",
  "image/heif"
]);
const DOCUMENT_EXTENSIONS = new Set(["doc", "docx", "xls", "xlsx", "pdf", "txt"]);
const DOCUMENT_MIME_TYPES = new Set([
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/msexcel",
  "application/x-msexcel",
  "application/x-excel",
  "application/pdf",
  "text/plain"
]);
const FILE_ACCEPT = [
  "image/*",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".bmp",
  ".avif",
  ".heic",
  ".heif",
  ".jfif",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".pdf",
  ".txt",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/pdf",
  "text/plain"
].join(",");

const STUDENT_LABELS: AssetLabel[] = [
  { zh: "策略", en: "Strategy" },
  { zh: "本周曲线", en: "Weekly curve" },
  { zh: "统计", en: "Stats" }
];
const ASSISTANT_LABELS: AssetLabel[] = [
  { zh: "招聘数据", en: "Recruiting data" },
  { zh: "学员数据", en: "Student data" },
  { zh: "云电脑数据", en: "Cloud PC data" }
];
const LEADER_LABELS: AssetLabel[] = [
  { zh: "招聘数据总结", en: "Recruiting data summary" },
  { zh: "模拟交易总结", en: "Simulation trading summary" },
  { zh: "遇到的问题", en: "Issues encountered" }
];

function isImageLikeMime(mime: string) {
  return mime.startsWith("image/");
}

function isAllowedFile(file: File) {
  const name = String(file.name || "").toLowerCase();
  const ext = name.includes(".") ? name.split(".").pop() || "" : "";
  const mime = String(file.type || "").toLowerCase();
  return (
    IMAGE_EXTENSIONS.has(ext) ||
    IMAGE_MIME_TYPES.has(mime) ||
    DOCUMENT_EXTENSIONS.has(ext) ||
    DOCUMENT_MIME_TYPES.has(mime) ||
    isImageLikeMime(mime)
  );
}

function isImageAsset(fileName?: string | null, mimeType?: string | null) {
  const safeMime = String(mimeType || "").trim().toLowerCase();
  if (safeMime && (IMAGE_MIME_TYPES.has(safeMime) || safeMime.startsWith("image/"))) return true;
  const safeName = String(fileName || "").trim().toLowerCase();
  const ext = safeName.includes(".") ? safeName.split(".").pop() || "" : "";
  return IMAGE_EXTENSIONS.has(ext);
}

function withQueryParam(url: string, key: string, value: string) {
  const raw = String(url || "").trim();
  if (!raw) return raw;
  const encoded = encodeURIComponent(value);
  if (new RegExp(`([?&])${key}=`).test(raw)) {
    return raw.replace(new RegExp(`([?&])${key}=[^&]*`), `$1${key}=${encoded}`);
  }
  return `${raw}${raw.includes("?") ? "&" : "?"}${key}=${encoded}`;
}

function buildDownloadUrl(url: string, fileName?: string | null, mimeType?: string | null) {
  let next = withQueryParam(url, "disposition", "attachment");
  const safeName = String(fileName || "").trim();
  if (safeName) next = withQueryParam(next, "filename", safeName);
  const safeMime = String(mimeType || "").trim();
  if (safeMime) next = withQueryParam(next, "contentType", safeMime);
  return next;
}

function useObjectUrl(file: File | null) {
  const [url, setUrl] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!file) {
      setUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);
  return url;
}

function fieldTextsFromItem(item: WeeklySummaryItem | null | undefined): FieldTexts {
  return {
    strategy: String(item?.strategy_text || "").trim(),
    curve: String(item?.curve_text || "").trim(),
    stats: String(item?.stats_text || "").trim()
  };
}

function visibleSummary(summaryText: string | null | undefined, fieldTexts: FieldTexts) {
  const summary = String(summaryText || "").trim();
  if (!summary) return "";
  const joinedFields = FIELD_KEYS.map((key) => fieldTexts[key]).filter(Boolean).join("\n\n").trim();
  if (joinedFields && summary === joinedFields) return "";
  if (summary === "Attachments submitted.") return "";
  return summary;
}

function labelsForRole(role: string): AssetLabel[] {
  if (role === "assistant") return ASSISTANT_LABELS;
  if (role === "leader") return LEADER_LABELS;
  return STUDENT_LABELS;
}

function labelText(label: AssetLabel, locale: Locale) {
  return locale === "zh" ? label.zh : label.en;
}

export function WeeklySummariesClient({ locale }: { locale: Locale }) {
  const [items, setItems] = React.useState<WeeklySummaryItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [uploading, setUploading] = React.useState(false);
  const [studentName, setStudentName] = React.useState("");
  const [summaryText, setSummaryText] = React.useState("");
  const [strategyFile, setStrategyFile] = React.useState<File | null>(null);
  const [curveFile, setCurveFile] = React.useState<File | null>(null);
  const [statsFile, setStatsFile] = React.useState<File | null>(null);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editingEntry, setEditingEntry] = React.useState<WeeklySummaryItem | null>(null);
  const [preview, setPreview] = React.useState<{ name: string; url: string; mimeType?: string | null } | null>(
    null
  );
  const [dragTarget, setDragTarget] = React.useState<SummaryKey | null>(null);
  const [role, setRole] = React.useState<string>("student");

  const formRef = React.useRef<HTMLDivElement | null>(null);
  const strategyRef = React.useRef<HTMLInputElement | null>(null);
  const curveRef = React.useRef<HTMLInputElement | null>(null);
  const statsRef = React.useRef<HTMLInputElement | null>(null);
  const uploadingRef = React.useRef(false);
  const strategyPreview = useObjectUrl(strategyFile);
  const curvePreview = useObjectUrl(curveFile);
  const statsPreview = useObjectUrl(statsFile);

  const load = React.useCallback(async (options?: { forceFresh?: boolean; silent?: boolean }) => {
    const forceFresh = Boolean(options?.forceFresh);
    const silent = Boolean(options?.silent);
    if (!silent) setLoading(true);
    if (forceFresh || !silent) setError(null);
    try {
      const listUrl = forceFresh
        ? `/api/system/weekly-summaries/list?fresh=1&_=${Date.now()}`
        : "/api/system/weekly-summaries/list";
      const result = await fetchSystemJson<{ ok?: boolean; items?: WeeklySummaryItem[] }>(listUrl, {
        fresh: forceFresh,
        dedupeKey: forceFresh ? "weekly-summaries:list:fresh" : "weekly-summaries:list",
        dedupeWindowMs: forceFresh ? 0 : 700,
        preferStale: false,
        revalidateInBackground: false,
        staleTtlMs: 0,
        retries: 2,
        retryBaseMs: 260,
        retryMaxMs: 1500
      });
      if (!result.ok) throw new Error(result.errorCode || "load_failed");
      const body = (result.body || {}) as any;
      setItems(Array.isArray(body.items) ? body.items : []);
    } catch (e: any) {
      if (!silent) setError(e?.message || "load_failed");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load({ forceFresh: false });
  }, [load]);

  useSystemRealtimeRefresh(
    () => {
      void load({ forceFresh: true, silent: true });
    },
    {
      tables: ["weekly_summaries"],
      throttleMs: 3000,
      globalThrottleMs: 3800,
      dedupeKey: "weekly-summaries:list"
    }
  );

  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const result = await fetchSystemJson<{ ok?: boolean; user?: { role?: string | null; full_name?: string | null } }>(
          "/api/system/me",
          {
            dedupeKey: "weekly-summaries:me",
            retries: 1,
            retryBaseMs: 200,
            retryMaxMs: 1000
          }
        );
        const json = (result.body || {}) as any;
        if (!alive) return;
        if (result.ok && json?.ok) {
          setRole(String(json.user?.role || "student"));
          if (!studentName) {
            const fallback = String(json.user?.full_name || "").trim();
            if (fallback) setStudentName(fallback);
          }
        }
      } catch {
        // Ignore profile hydration failures; the API still derives the submitted name from the session.
      }
    })();
    return () => {
      alive = false;
    };
  }, [studentName]);

  const orderedItems = React.useMemo(() => {
    const list = [...items];
    list.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
    return list;
  }, [items]);

  const { pageItems, page, pageSize, setPage, setPageSize, pageCount, total } = usePagination(orderedItems, {
    pageSize: 10
  });

  const resetForm = () => {
    setSummaryText("");
    setEditingId(null);
    setEditingEntry(null);
    setStrategyFile(null);
    setCurveFile(null);
    setStatsFile(null);
    if (strategyRef.current) strategyRef.current.value = "";
    if (curveRef.current) curveRef.current.value = "";
    if (statsRef.current) statsRef.current.value = "";
  };

  const startEdit = (item: WeeklySummaryItem) => {
    setEditingId(item.id);
    setEditingEntry(item);
    setStudentName(item.student_name || studentName);
    setSummaryText(item.summary_text || "");
    setStrategyFile(null);
    setCurveFile(null);
    setStatsFile(null);
    if (strategyRef.current) strategyRef.current.value = "";
    if (curveRef.current) curveRef.current.value = "";
    if (statsRef.current) statsRef.current.value = "";
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const setFileForKey = (key: SummaryKey, file: File | null) => {
    if (key === "strategy") setStrategyFile(file);
    else if (key === "curve") setCurveFile(file);
    else setStatsFile(file);
  };

  const handleFile = (key: SummaryKey, file: File | null, ref: React.RefObject<HTMLInputElement>) => {
    if (ref.current) ref.current.value = "";
    if (!file) return;
    if (!isAllowedFile(file)) {
      setError(
        locale === "zh"
          ? "请上传图片（png/jpg/jpeg/webp/gif/bmp/avif/heic/heif/jfif）或 doc/docx/xls/xlsx/pdf/txt 文件。"
          : "Please upload an image (png/jpg/jpeg/webp/gif/bmp/avif/heic/heif/jfif) or doc/docx/xls/xlsx/pdf/txt file."
      );
      return;
    }
    setError(null);
    setFileForKey(key, file);
  };

  const onDragOver = (key: SummaryKey) => (e: React.DragEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    if (dragTarget !== key) setDragTarget(key);
  };

  const onDragLeave = (key: SummaryKey) => () => {
    if (dragTarget === key) setDragTarget(null);
  };

  const onDropFile = (key: SummaryKey, ref: React.RefObject<HTMLInputElement>) => (e: React.DragEvent<HTMLButtonElement>) => {
    e.preventDefault();
    setDragTarget(null);
    handleFile(key, e.dataTransfer.files?.[0] || null, ref);
  };

  const submit = async () => {
    if (uploadingRef.current) return;
    const trimmedName = studentName.trim();
    if (!trimmedName) {
      setError(locale === "zh" ? "请填写姓名。" : "Name is required.");
      return;
    }

    const fieldTexts: FieldTexts = {
      strategy: "",
      curve: "",
      stats: ""
    };
    const hasRequiredFields =
      Boolean(strategyFile || editingEntry?.strategy_url) &&
      Boolean(curveFile || editingEntry?.curve_url) &&
      Boolean(statsFile || editingEntry?.stats_url);
    if (!hasRequiredFields) {
      setError(
        locale === "zh"
          ? "请分别上传策略、本周曲线、统计三项文件。"
          : "Please upload files for Strategy, Weekly curve, and Stats."
      );
      return;
    }

    const trimmedSummary = summaryText.trim();
    setUploading(true);
    uploadingRef.current = true;
    setError(null);
    try {
      const requestId = createClientRequestId(editingId ? `weekly_edit_${editingId}` : "weekly_new");
      const pendingFiles: Array<{ key: SummaryKey; file: File }> = [];
      if (strategyFile) pendingFiles.push({ key: "strategy", file: strategyFile });
      if (curveFile) pendingFiles.push({ key: "curve", file: curveFile });
      if (statsFile) pendingFiles.push({ key: "stats", file: statsFile });

      const submitWithFormData = async () => {
        const form = new FormData();
        form.set("requestId", requestId);
        form.set("summaryText", trimmedSummary);
        form.set("strategyText", fieldTexts.strategy);
        form.set("curveText", fieldTexts.curve);
        form.set("statsText", fieldTexts.stats);
        if (editingId) form.set("entryId", editingId);
        if (strategyFile) form.set("strategy", strategyFile);
        if (curveFile) form.set("curve", curveFile);
        if (statsFile) form.set("stats", statsFile);
        const res = await fetch("/api/system/weekly-summaries/upload", {
          method: "POST",
          body: form,
          credentials: "include"
        });
        const body = (await res.json().catch(() => null)) as any;
        if (!res.ok || !body?.ok) throw new Error(body?.error || "upload_failed");
      };

      if (pendingFiles.length) {
        try {
          let entryId = editingId || "";
          const presignResult = await fetchSystemJson("/api/system/weekly-summaries/presign", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              requestId,
              entryId: editingId || undefined,
              files: pendingFiles.map((item) => ({
                key: item.key,
                name: item.file.name || "",
                size: item.file.size,
                type: item.file.type || ""
              }))
            }),
            retries: 1,
            retryBaseMs: 220,
            retryMaxMs: 1200
          });
          const presignJson = (presignResult.body || null) as any;
          if (!presignResult.ok || !presignJson?.ok) {
            throw new Error(presignJson?.error || presignResult.errorCode || "presign_failed");
          }

          entryId = String(presignJson.entryId || "");
          const uploadInfos = (Array.isArray(presignJson.uploads) ? presignJson.uploads : []) as PresignedUpload[];
          if (!entryId || uploadInfos.length !== pendingFiles.length) throw new Error("presign_failed");

          const uploadsByKey = new Map<SummaryKey, PresignedUpload>(uploadInfos.map((item) => [item.key, item]));
          for (const item of pendingFiles) {
            const upload = uploadsByKey.get(item.key);
            if (!upload?.uploadUrl) throw new Error("upload_failed");
            const putRes = await fetch(String(upload.uploadUrl), {
              method: "PUT",
              headers: { "Content-Type": item.file.type || "application/octet-stream" },
              body: item.file
            });
            if (!putRes.ok) throw new Error("upload_failed");
          }

          const finalizeResult = await fetchSystemJson("/api/system/weekly-summaries/upload", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              requestId,
              entryId,
              summaryText: trimmedSummary,
              fieldTexts,
              files: uploadInfos.map((upload: any) => {
                const source = pendingFiles.find((item) => item.key === upload.key);
                return {
                  key: upload.key,
                  bucket: upload.bucket,
                  path: upload.path,
                  fileName: upload.fileName || source?.file.name || "",
                  size: source?.file.size || 0,
                  mimeType: source?.file.type || null
                };
              })
            }),
            retries: 1,
            retryBaseMs: 220,
            retryMaxMs: 1200
          });
          const finalizeJson = (finalizeResult.body || null) as any;
          if (!finalizeResult.ok || !finalizeJson?.ok) {
            throw new Error(finalizeJson?.error || finalizeResult.errorCode || "upload_failed");
          }
        } catch {
          await submitWithFormData();
        }
      } else {
        const finalizeResult = await fetchSystemJson("/api/system/weekly-summaries/upload", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            requestId,
            entryId: editingId || undefined,
            summaryText: trimmedSummary,
            fieldTexts,
            files: []
          }),
          retries: 1,
          retryBaseMs: 220,
          retryMaxMs: 1200
        });
        const finalizeJson = (finalizeResult.body || null) as any;
        if (!finalizeResult.ok || !finalizeJson?.ok) {
          throw new Error(finalizeJson?.error || finalizeResult.errorCode || "upload_failed");
        }
      }

      resetForm();
      await load({ forceFresh: true });
    } catch (e: any) {
      setError(e?.message || "upload_failed");
    } finally {
      uploadingRef.current = false;
      setUploading(false);
    }
  };

  const fieldLabels = labelsForRole(role);
  const title =
    role === "leader"
      ? locale === "zh"
        ? "团队长周总结"
        : "Leader Weekly Summary"
      : locale === "zh"
        ? "周总结"
        : "Weekly Summary";
  const nameLabel = role === "leader" ? (locale === "zh" ? "姓名" : "Name") : locale === "zh" ? "学员名称" : "Student name";
  const uploadHint =
    locale === "zh"
      ? "支持图片格式 png/jpg/jpeg/webp/gif/bmp/avif/heic/heif/jfif，或 doc/docx/xls/xlsx/pdf/txt 文件。"
      : "Supports images (png/jpg/jpeg/webp/gif/bmp/avif/heic/heif/jfif) or doc/docx/xls/xlsx/pdf/txt files.";
  const uploadPlaceholder = locale === "zh" ? "上传图片/文件" : "Upload image/file";

  const filesByKey: Record<SummaryKey, File | null> = {
    strategy: strategyFile,
    curve: curveFile,
    stats: statsFile
  };
  const previewsByKey: Record<SummaryKey, string | null> = {
    strategy: strategyPreview,
    curve: curvePreview,
    stats: statsPreview
  };
  const refsByKey: Record<SummaryKey, React.RefObject<HTMLInputElement>> = {
    strategy: strategyRef,
    curve: curveRef,
    stats: statsRef
  };
  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
        <div className="text-xl font-semibold text-white/90">{title}</div>
        <div className="mt-2 text-sm text-white/60">
          {locale === "zh"
            ? "请分别上传三项材料：策略、本周曲线、统计。支持图片和文档文件，三项都不能为空。"
            : "Upload all three materials: strategy, weekly curve, and stats. Images and document files are supported; none can be empty."}
        </div>
      </div>

      <div ref={formRef} className="space-y-4 rounded-3xl border border-white/10 bg-white/5 p-6">
        <div className="font-semibold text-white/85">
          {editingId
            ? locale === "zh"
              ? "修改周总结"
              : "Edit weekly summary"
            : locale === "zh"
              ? "上传周总结"
              : "Upload weekly summary"}
        </div>

        <div className="space-y-2">
          <label className="text-xs text-white/60">{nameLabel}</label>
          <input
            value={studentName}
            readOnly
            className="w-full cursor-not-allowed select-none rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/70"
            placeholder={locale === "zh" ? "请输入姓名" : "Enter name"}
          />
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {FIELD_KEYS.map((key, index) => {
            const label = labelText(fieldLabels[index], locale);
            const selectedFile = filesByKey[key];
            const selectedPreview = previewsByKey[key];
            const ref = refsByKey[key];
            const currentUrl = editingEntry?.[`${key}_url` as keyof WeeklySummaryItem] as string | null | undefined;
            const currentName = editingEntry?.[`${key}_name` as keyof WeeklySummaryItem] as string | null | undefined;
            const currentMime = editingEntry?.[`${key}_mime_type` as keyof WeeklySummaryItem] as string | null | undefined;
            const showSelectedImage =
              selectedFile && selectedPreview && isImageAsset(selectedFile.name, selectedFile.type || null);
            const showCurrentImage = !selectedFile && currentUrl && isImageAsset(currentName, currentMime);
            return (
              <div key={key} className="space-y-2">
                <label className="text-xs text-white/60">{label}</label>
                <input
                  ref={ref}
                  type="file"
                  accept={FILE_ACCEPT}
                  onChange={() => handleFile(key, ref.current?.files?.[0] || null, ref)}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => ref.current?.click()}
                  onDragOver={onDragOver(key)}
                  onDragLeave={onDragLeave(key)}
                  onDrop={onDropFile(key, ref)}
                  data-drag={dragTarget === key ? "1" : "0"}
                  className="system-upload-card h-[140px] w-full"
                >
                  {showSelectedImage ? (
                    <img src={selectedPreview || ""} alt={selectedFile?.name || label} loading="lazy" decoding="async" />
                  ) : showCurrentImage ? (
                    <img
                      src={withQueryParam(currentUrl || "", "disposition", "inline")}
                      alt={currentName || label}
                      loading="lazy"
                      decoding="async"
                    />
                  ) : selectedFile ? (
                    <div className="system-upload-placeholder">
                      <div className="max-w-[180px] truncate">{selectedFile.name}</div>
                      <div className="text-white/45">{locale === "zh" ? "已选择文件" : "Selected file"}</div>
                    </div>
                  ) : (
                    <div className="system-upload-placeholder">
                      <div className="system-upload-plus">+</div>
                      <div>{uploadPlaceholder}</div>
                    </div>
                  )}
                </button>
                <div className="system-upload-hint">{uploadHint}</div>
                {selectedFile ? (
                  <div className="text-xs text-white/50">{selectedFile.name}</div>
                ) : currentName ? (
                  <div className="text-xs text-white/50">
                    {locale === "zh" ? "已上传：" : "Current: "}
                    {currentName}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        <div className="space-y-2">
          <label className="text-xs text-white/60">
            {locale === "zh" ? "整体补充（选填）" : "Overall note (optional)"}
          </label>
          <textarea
            value={summaryText}
            onChange={(e) => setSummaryText(e.target.value)}
            className="min-h-[120px] w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/85"
            placeholder={locale === "zh" ? "可填写本周整体补充说明..." : "Optional overall note..."}
          />
        </div>

        {error ? (
          <div className="rounded-2xl border border-rose-400/20 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">
            {error}
          </div>
        ) : null}

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={uploading}
            onClick={submit}
            className="inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm text-white hover:bg-white/15 disabled:opacity-50"
          >
            <UploadCloud className="h-4 w-4" />
            {uploading
              ? locale === "zh"
                ? "提交中..."
                : "Submitting..."
              : editingId
                ? locale === "zh"
                  ? "修改提交"
                  : "Update"
                : locale === "zh"
                  ? "提交"
                  : "Submit"}
          </button>
          {editingId ? (
            <button
              type="button"
              disabled={uploading}
              onClick={resetForm}
              className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/70 hover:bg-white/10 disabled:opacity-50"
            >
              {locale === "zh" ? "取消修改" : "Cancel edit"}
            </button>
          ) : null}
        </div>
      </div>

      {loading ? (
        <div className="rounded-3xl border border-white/10 bg-white/5 p-6 text-white/60">
          {locale === "zh" ? "加载中..." : "Loading..."}
        </div>
      ) : null}

      {!loading && !items.length ? (
        <div className="rounded-3xl border border-white/10 bg-white/5 p-6 text-white/60">
          {locale === "zh" ? "暂无记录" : "No submissions yet."}
        </div>
      ) : null}

      <div className="space-y-4">
        {pageItems.map((item) => {
          const reviewed = Boolean(item.reviewed_at);
          const status = reviewed ? (locale === "zh" ? "已阅" : "Reviewed") : locale === "zh" ? "待阅" : "Pending";
          const statusClass = reviewed ? "text-emerald-300" : "text-amber-200";
          const itemTexts = fieldTextsFromItem(item);
          const itemSummary = visibleSummary(item.summary_text, itemTexts);
          const itemLabels = labelsForRole(role);
          const assets = FIELD_KEYS.map((key, index) => ({
            key,
            label: labelText(itemLabels[index], locale),
            url: item[`${key}_url` as keyof WeeklySummaryItem] as string | null | undefined,
            name: item[`${key}_name` as keyof WeeklySummaryItem] as string | null | undefined,
            mimeType: item[`${key}_mime_type` as keyof WeeklySummaryItem] as string | null | undefined
          }));

          return (
            <div key={item.id} className="space-y-4 rounded-3xl border border-white/10 bg-white/5 p-6">
              <div className="flex flex-wrap items-center gap-3">
                <div className="font-semibold text-white/90">{item.student_name || "-"}</div>
                <div className={`text-xs ${statusClass}`}>{status}</div>
                <div className="ml-auto text-xs text-white/50">
                  <ClientDateTime value={item.created_at} />
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                {assets.map((asset) => {
                  const canPreview = Boolean(asset.url);
                  const showThumb = canPreview && isImageAsset(asset.name, asset.mimeType);
                  const inlineUrl = asset.url ? withQueryParam(asset.url, "disposition", "inline") : "";
                  return (
                    <div key={asset.key} className={canPreview ? "space-y-2" : ""}>
                      <button
                        type="button"
                        disabled={!canPreview}
                        onClick={() =>
                          canPreview &&
                          setPreview({
                            url: asset.url || "",
                            name: asset.name || asset.label,
                            mimeType: asset.mimeType
                          })
                        }
                        className="group relative h-[140px] w-full overflow-hidden rounded-2xl border border-white/10 bg-white/5"
                      >
                        {canPreview ? (
                          showThumb ? (
                            <img
                              src={inlineUrl}
                              alt={asset.name || asset.label}
                              loading="lazy"
                              decoding="async"
                              className="h-full w-full object-cover transition group-hover:scale-105"
                            />
                          ) : (
                            <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-xs text-white/70">
                              <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
                                {locale === "zh" ? "点击预览" : "Preview"}
                              </div>
                              <div className="max-w-[160px] truncate text-white/60">{asset.name || asset.label}</div>
                            </div>
                          )
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-xs text-white/50">
                            {locale === "zh" ? "未上传文件" : "No file uploaded"}
                          </div>
                        )}
                        <div className="absolute left-2 top-2 rounded-lg bg-black/40 px-2 py-1 text-[11px] text-white/80">
                          {asset.label}
                        </div>
                      </button>
                      {canPreview ? (
                        <a
                          href={asset.url ? buildDownloadUrl(asset.url, asset.name, asset.mimeType) : "#"}
                          target="_blank"
                          rel="noreferrer"
                          download={asset.name || undefined}
                          className="inline-flex items-center justify-center rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/80 hover:bg-white/10"
                        >
                          {locale === "zh" ? "下载" : "Download"}
                        </a>
                      ) : null}
                    </div>
                  );
                })}
              </div>

              {itemSummary ? <div className="whitespace-pre-wrap text-sm text-white/85">{itemSummary}</div> : null}
              {item.review_note ? (
                <div className="text-xs text-white/60">
                  {locale === "zh" ? "审核备注" : "Review note"}: {item.review_note}
                </div>
              ) : null}

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={uploading}
                  onClick={() => startEdit(item)}
                  className="rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/75 hover:bg-white/10 disabled:opacity-50"
                >
                  {locale === "zh" ? "编辑" : "Edit"}
                </button>
                <span className="text-xs text-white/40">
                  {locale === "zh" ? "不可删除，仅支持修改" : "No delete; edits only."}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {!loading && orderedItems.length ? (
        <div className="rounded-3xl border border-white/10 bg-white/5">
          <PaginationControls
            total={total}
            page={page}
            pageSize={pageSize}
            pageCount={pageCount}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
            locale={locale}
          />
        </div>
      ) : null}

      <PreviewModal
        file={preview ? { name: preview.name, url: preview.url, mimeType: preview.mimeType || undefined } : null}
        locale={locale}
        onClose={() => setPreview(null)}
      />
    </div>
  );
}
