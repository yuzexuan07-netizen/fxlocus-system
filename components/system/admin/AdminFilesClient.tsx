"use client";

import React from "react";
import { FileText, FileVideo, UploadCloud } from "lucide-react";

import { fetchSystemJson } from "@/lib/system/clientFetch";
import { createClientRequestId } from "@/lib/system/clientRequestId";
import { useSystemRealtimeRefresh } from "@/lib/system/useSystemRealtimeRefresh";
import { ClientDateTime } from "@/components/system/ClientDateTime";
import { PreviewModal } from "@/components/system/PreviewModal";

type FileRow = {
  id: string;
  category: string;
  name: string;
  description?: string | null;
  storage_bucket: string;
  storage_path: string;
  size_bytes: number;
  mime_type?: string | null;
  created_at: string;
};

function safeDecode(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function bytesToHuman(bytes: number) {
  if (!bytes || bytes < 0) return "-";
  const units = ["B", "KB", "MB", "GB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function fileTypeLabel(mimeType: string | null | undefined) {
  const mime = String(mimeType || "").toLowerCase();
  if (mime.startsWith("image/")) return "IMG";
  if (mime.includes("pdf")) return "PDF";
  if (mime.includes("word") || mime.includes("officedocument")) return "DOC";
  if (mime.includes("mp4")) return "MP4";
  return mime ? mime.split("/").pop() || "FILE" : "FILE";
}

function resolveFileName(file: Pick<FileRow, "id" | "name" | "storage_path">) {
  const raw = String(file.name || "").trim();
  if (raw) return raw;
  const storagePath = String(file.storage_path || "").trim();
  const fromPathRaw = storagePath.split("/").pop() || "";
  const fromPath = safeDecode(fromPathRaw);
  if (fromPath) return fromPath;
  const suffix = String(file.id || "").trim().slice(0, 8);
  return suffix ? `file-${suffix}` : "download";
}

function isAllowedUpload(file: File) {
  const name = (file.name || "").toLowerCase();
  const mime = (file.type || "").toLowerCase();
  const ext = name.includes(".") ? name.split(".").pop() || "" : "";
  const allowedExt = [
    "pdf",
    "doc",
    "docx",
    "mp4",
    "ex4",
    "zip",
    "png",
    "jpg",
    "jpeg",
    "webp",
    "gif",
    "bmp",
    "avif",
    "heic",
    "heif",
    "jfif"
  ];
  const allowedMime = [
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "video/mp4",
    "application/zip",
    "application/x-zip-compressed",
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/webp",
    "image/gif",
    "image/bmp",
    "image/avif",
    "image/heic",
    "image/heif"
  ];

  if (mime.startsWith("image/")) return true;
  if (allowedMime.includes(mime)) return true;
  if (allowedExt.includes(ext)) return true;
  return false;
}

const MAX_FILE_BYTES = 1024 * 1024 * 1024;

export function AdminFilesClient({ locale }: { locale: "zh" | "en" }) {
  const [items, setItems] = React.useState<FileRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [uploading, setUploading] = React.useState(false);
  const [grantingId, setGrantingId] = React.useState<string | null>(null);
  const [deletingId, setDeletingId] = React.useState<string | null>(null);
  const [previewingId, setPreviewingId] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState<{ name: string; url: string; mimeType?: string | null } | null>(null);
  const [meRole, setMeRole] = React.useState<"leader" | "super_admin" | null>(null);

  const [uploadForm, setUploadForm] = React.useState({
    category: locale === "zh" ? "教材PDF" : "PDF",
    name: "",
    description: ""
  });
  const [file, setFile] = React.useState<File | null>(null);
  const [dragActive, setDragActive] = React.useState(false);

  const [grantEmail, setGrantEmail] = React.useState<Record<string, string>>({});
  const uploadRef = React.useRef<HTMLFormElement | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  const categoryOptions =
    locale === "zh"
      ? ["教材PDF", "课程视频", "模拟交易策略", "其他"]
      : ["PDF", "Videos", "Strategies", "Other"];
  const defaultCategory = categoryOptions[0] || (locale === "zh" ? "教材PDF" : "PDF");
  const canUpload = meRole === "super_admin";

  const applyFile = React.useCallback(
    (next: File | null) => {
      if (!next) {
        setFile(null);
        return;
      }
      if (!isAllowedUpload(next)) {
        setError(
          locale === "zh"
            ? "仅支持 图片/DOC/DOCX/PDF/MP4/EX4/ZIP"
            : "Only images, DOC/DOCX/PDF/MP4/EX4/ZIP are supported"
        );
        if (fileInputRef.current) fileInputRef.current.value = "";
        return;
      }
      if (next.size > MAX_FILE_BYTES) {
        setError(locale === "zh" ? "文件大小不能超过 1GB" : "File must be <= 1GB");
        if (fileInputRef.current) fileInputRef.current.value = "";
        return;
      }
      setError(null);
      setFile(next);
    },
    [locale]
  );

  const jumpToUpload = () => {
    uploadRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchSystemJson<{ ok?: boolean; items?: FileRow[] }>("/api/system/admin/files/list", {
        dedupeKey: "admin-files:list",
        retries: 2,
        retryBaseMs: 260,
        retryMaxMs: 1500
      });
      const json = (result.body || null) as any;
      if (!result.ok || !json?.ok) throw new Error(json?.error || result.errorCode || "load_failed");
      setItems(Array.isArray(json.items) ? json.items : []);
    } catch (e: any) {
      setError(e?.message || "load_failed");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  useSystemRealtimeRefresh(load, {
    tables: ["files", "file_permissions", "file_access_requests"],
    throttleMs: 3000,
    globalThrottleMs: 3600,
    dedupeKey: "admin-files:list"
  });

  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const result = await fetchSystemJson<{ ok?: boolean; user?: { role?: string | null } }>("/api/system/me", {
          dedupeKey: "admin-files:me",
          retries: 1,
          dedupeWindowMs: 1200
        });
        const json = (result.body || null) as any;
        if (!alive) return;
        const role = json?.ok ? String(json?.user?.role || "") : "";
        if (role === "super_admin") setMeRole("super_admin");
        else if (role === "leader") setMeRole("leader");
      } catch {
        // ignore
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const upload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;
    const ok = window.confirm(locale === "zh" ? "确认上传该文件？" : "Upload this file?");
    if (!ok) return;
    setUploading(true);
    setError(null);
    try {
      if (file.size > MAX_FILE_BYTES) {
        throw new Error(locale === "zh" ? "文件大小不能超过 1GB" : "File must be <= 1GB");
      }
      if (!isAllowedUpload(file)) {
        throw new Error(
          locale === "zh"
            ? "仅允许上传 图片/doc/docx/pdf/mp4/ex4/zip"
            : "Only images/doc/docx/pdf/mp4/ex4/zip allowed"
        );
      }
      const fd = new FormData();
      fd.set("requestId", createClientRequestId("admin_file"));
      fd.set("file", file);
      fd.set("category", uploadForm.category);
      fd.set("name", uploadForm.name || file.name);
      fd.set("description", uploadForm.description);
      const result = await fetchSystemJson("/api/system/admin/files/upload", {
        method: "POST",
        body: fd,
        dedupeKey: "admin-files:upload",
        retries: 1,
        dedupeWindowMs: 300
      });
      const json = (result.body || null) as any;
      if (!result.ok || !json?.ok) throw new Error(json?.error || result.errorCode || "upload_failed");
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      setUploadForm({ category: defaultCategory, name: "", description: "" });
      await load();
    } catch (e: any) {
      setError(e?.message || "upload_failed");
    } finally {
      setUploading(false);
    }
  };

  const grant = async (fileId: string) => {
    const keyword = (grantEmail[fileId] || "").trim();
    if (!keyword) return;
    const ok = window.confirm(locale === "zh" ? "确认授权给该学员？" : "Grant access to this learner?");
    if (!ok) return;
    setGrantingId(fileId);
    setError(null);
    try {
      const result = await fetchSystemJson("/api/system/admin/files/grant", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fileId, keyword }),
        retries: 1,
        dedupeWindowMs: 0
      });
      const json = (result.body || null) as any;
      if (!result.ok || !json?.ok) throw new Error(json?.error || result.errorCode || "grant_failed");
      setGrantEmail((p) => ({ ...p, [fileId]: "" }));
    } catch (e: any) {
      setError(e?.message || "grant_failed");
    } finally {
      setGrantingId(null);
    }
  };

  const openPreview = (item: FileRow) => {
    if (!item?.id) return;
    setPreviewingId(item.id);
    setError(null);
    const encodedId = encodeURIComponent(String(item.id));
    const displayName = resolveFileName(item);
    setPreview({
      name: displayName,
      url: `/api/system/files/${encodedId}/download?disposition=inline`,
      mimeType: item.mime_type
    });
    setPreviewingId(null);
  };

  const removeFile = async (fileId: string) => {
    const ok = window.confirm(locale === "zh" ? "确认删除该文件？" : "Delete this file?");
    if (!ok) return;
    setDeletingId(fileId);
    setError(null);
    try {
      const result = await fetchSystemJson("/api/system/admin/files/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fileId }),
        retries: 1,
        dedupeWindowMs: 0
      });
      const json = (result.body || null) as any;
      if (!result.ok || !json?.ok) throw new Error(json?.error || result.errorCode || "delete_failed");
      await load();
    } catch (e: any) {
      setError(e?.message || "delete_failed");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
        <div className="text-white/90 font-semibold text-xl">
          {locale === "zh" ? "文件库" : "File library"}
        </div>
        <div className="mt-2 text-white/60 text-sm">
          {locale === "zh"
            ? canUpload
              ? "上传资料并授权给学员（邮箱/姓名均可）。"
              : "查看文件并授权给学员（邮箱/姓名均可）。"
            : canUpload
              ? "Upload files and grant access by student email or name."
              : "Review files and grant access by student email or name."}
        </div>
      </div>

      {canUpload ? (
        <form ref={uploadRef} onSubmit={upload} className="rounded-3xl border border-white/10 bg-white/5 p-6 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="text-white/85 font-semibold">{locale === "zh" ? "上传文件" : "Upload"}</div>
            <div className="text-xs text-white/50">
              {locale === "zh"
                ? "支持 图片/DOC/DOCX/PDF/MP4/EX4/ZIP，单文件 <= 1GB"
                : "Images/DOC/DOCX/PDF/MP4/EX4/ZIP, <= 1GB"}
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <select
              value={uploadForm.category}
              onChange={(e) => setUploadForm((p) => ({ ...p, category: e.target.value }))}
              className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-white/85 text-sm"
            >
              {categoryOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
            <input
              value={uploadForm.name}
              onChange={(e) => setUploadForm((p) => ({ ...p, name: e.target.value }))}
              className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-white/85 text-sm"
              placeholder={locale === "zh" ? "显示名称（可选）" : "Display name (optional)"}
            />
            <input
              value={uploadForm.description}
              onChange={(e) => setUploadForm((p) => ({ ...p, description: e.target.value }))}
              className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-white/85 text-sm"
              placeholder={locale === "zh" ? "描述（可选）" : "Description (optional)"}
            />
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "copy";
                  if (!dragActive) setDragActive(true);
                }}
                onDragLeave={() => setDragActive(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragActive(false);
                  applyFile(e.dataTransfer.files?.[0] || null);
                }}
                data-drag={dragActive ? "1" : "0"}
                className="system-upload-card h-[140px] w-full"
              >
                {file ? (
                  <div className="system-upload-placeholder">
                    <FileText className="h-5 w-5 text-white/70" />
                    <div className="text-sm text-white/80">{file.name}</div>
                  </div>
                ) : (
                  <div className="system-upload-placeholder">
                    <div className="system-upload-plus">+</div>
                    <div>{locale === "zh" ? "点击上传文件" : "Upload file"}</div>
                  </div>
                )}
              </button>
              <div className="system-upload-hint">
                {locale === "zh"
                  ? "支持 图片/DOC/DOCX/PDF/MP4/EX4/ZIP"
                  : "Images/DOC/DOCX/PDF/MP4/EX4/ZIP supported"}
              </div>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              onChange={(e) => {
                const next = e.target.files?.[0] || null;
                applyFile(next);
              }}
              className="hidden"
              accept="image/*,.pdf,.doc,.docx,.mp4,.ex4,.zip,application/pdf,video/mp4,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/zip,application/x-zip-compressed"
            />
          </div>
          <button
            type="submit"
            disabled={uploading || !file}
            className="px-4 py-2 rounded-xl bg-white/10 border border-white/20 text-white hover:bg-white/15 disabled:opacity-50"
          >
            {uploading ? (locale === "zh" ? "上传中..." : "Uploading...") : locale === "zh" ? "上传" : "Upload"}
          </button>
        </form>
      ) : null}

      {error ? (
        <div className="rounded-3xl border border-rose-400/20 bg-rose-500/10 p-6 text-rose-100">
          {error}
        </div>
      ) : null}

      <div className="rounded-3xl border border-white/10 bg-white/5 overflow-hidden">
        <div className="px-6 py-4 border-b border-white/10 text-white/85 font-semibold flex items-center gap-2">
          <span>{locale === "zh" ? "文件列表" : "Files"}</span>
          {canUpload ? (
            <button
              type="button"
              onClick={jumpToUpload}
              className="ml-auto px-3 py-1.5 rounded-xl bg-white/5 border border-white/10 text-white/70 hover:bg-white/10"
            >
              {locale === "zh" ? "跳到上传" : "Jump to upload"}
            </button>
          ) : null}
        </div>

        {loading ? (
          <div className="p-6 text-white/60">{locale === "zh" ? "加载中..." : "Loading..."}</div>
        ) : null}

        {!loading && !items.length ? (
          <div className="p-6">
            <div className="rounded-3xl border border-dashed border-white/15 bg-white/5 p-10 text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/5">
                <UploadCloud className="h-5 w-5 text-white/70" />
              </div>
              <div className="text-white/80 font-semibold">
                {locale === "zh" ? "还没有上传文件" : "No files yet"}
              </div>
              <div className="mt-2 text-sm text-white/60">
                {canUpload
                  ? locale === "zh"
                    ? "点击按钮前往上传"
                    : "Click to upload your first file"
                  : locale === "zh"
                    ? "当前没有可用文件。"
                    : "No files available."}
              </div>
              {canUpload ? (
                <button
                  type="button"
                  onClick={jumpToUpload}
                  className="mt-4 px-4 py-2 rounded-xl bg-white/10 border border-white/20 text-white hover:bg-white/15"
                >
                  {locale === "zh" ? "上传文件" : "Upload file"}
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="divide-y divide-white/10">
          {items.map((f) => (
            <div key={f.id} className="px-6 py-4">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2 text-white/90 font-semibold">
                  {String(f.mime_type || "").toLowerCase().includes("mp4") ? (
                    <FileVideo className="h-4 w-4 text-white/70" />
                  ) : (
                    <FileText className="h-4 w-4 text-white/70" />
                  )}
                  <span>{resolveFileName(f)}</span>
                </div>
                <div className="text-xs text-white/50">{f.category}</div>
                <div className="text-xs text-white/50">{fileTypeLabel(f.mime_type)}</div>
                <div className="ml-auto text-xs text-white/50">
                  {bytesToHuman(f.size_bytes)} · <ClientDateTime value={f.created_at} />
                </div>
              </div>
              {f.description ? <div className="mt-2 text-sm text-white/70">{f.description}</div> : null}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={previewingId === f.id}
                  onClick={() => openPreview(f)}
                  className="px-3 py-1.5 rounded-xl bg-white/5 border border-white/10 text-white/80 hover:bg-white/10 disabled:opacity-50"
                >
                  {locale === "zh" ? "预览" : "Preview"}
                </button>
                <input
                  value={grantEmail[f.id] || ""}
                  onChange={(e) => setGrantEmail((p) => ({ ...p, [f.id]: e.target.value }))}
                  className="min-w-[280px] rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white/85"
                  placeholder={locale === "zh" ? "输入学员邮箱/姓名授权" : "Student email or name"}
                />
                <button
                  type="button"
                  disabled={grantingId === f.id}
                  onClick={() => grant(f.id)}
                  className="px-3 py-1.5 rounded-xl bg-white/10 border border-white/20 text-white hover:bg-white/15 disabled:opacity-50"
                >
                  {locale === "zh" ? "授权" : "Grant"}
                </button>
                <button
                  type="button"
                  disabled={deletingId === f.id}
                  onClick={() => removeFile(f.id)}
                  className="px-3 py-1.5 rounded-xl bg-rose-500/10 border border-rose-400/20 text-rose-100 hover:bg-rose-500/15 disabled:opacity-50"
                >
                  {locale === "zh" ? "删除" : "Delete"}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <PreviewModal
        file={preview ? { name: preview.name, url: preview.url, mimeType: preview.mimeType } : null}
        locale={locale}
        onClose={() => setPreview(null)}
      />
    </div>
  );
}
