"use client";

import React from "react";
import { FileText } from "lucide-react";

import { fetchSystemJson } from "@/lib/system/clientFetch";
import { createClientRequestId } from "@/lib/system/clientRequestId";
import { useSystemRealtimeRefresh } from "@/lib/system/useSystemRealtimeRefresh";
import { ClientDateTime } from "@/components/system/ClientDateTime";
import { PreviewModal } from "@/components/system/PreviewModal";
import { PaginationControls } from "@/components/ui/PaginationControls";
import { usePagination } from "@/components/ui/usePagination";

type SubmissionFile = {
  id: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number;
  url: string | null;
};

type SubmissionItem = {
  id: string;
  status: "submitted" | "approved" | "rejected";
  rejection_reason?: string | null;
  review_note?: string | null;
  created_at: string;
  files: SubmissionFile[];
};

type Config = {
  titleZh: string;
  titleEn: string;
  descZh: string;
  descEn: string;
  presignUrl?: string;
  uploadUrl: string;
  listUrl: string;
  allowedExt: Set<string>;
  allowedMime: Set<string>;
  accept: string;
};

const MAX_FILES = 3;
const LEARNER_ROLES = new Set(["student", "trader", "coach", "leader"]);

const CONFIG: Record<"trade_log" | "trade_strategy", Config> = {
  trade_log: {
    titleZh: "模拟交易日志",
    titleEn: "Simulation Trade Logs",
    descZh: "支持上传 PDF/DOC/DOCX，最多3 个文件。",
    descEn: "Upload PDF/DOC/DOCX, up to 3 files.",
    uploadUrl: "/api/system/trade-logs/upload",
    listUrl: "/api/system/trade-logs/list",
    allowedExt: new Set(["pdf", "doc", "docx"]),
    allowedMime: new Set([
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ]),
    accept:
      ".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  },
  trade_strategy: {
    titleZh: "模拟交易策略",
    titleEn: "Simulation Trade Strategies",
    descZh: "支持上传 PDF/DOC/DOCX/PNG/JPG，最多3 个文件。",
    descEn: "Upload PDF/DOC/DOCX/PNG/JPG, up to 3 files.",
    uploadUrl: "/api/system/trade-strategies/upload",
    listUrl: "/api/system/trade-strategies/list",
    allowedExt: new Set(["pdf", "doc", "docx", "png", "jpg", "jpeg"]),
    allowedMime: new Set([
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "image/png",
      "image/jpeg"
    ]),
    accept:
      ".pdf,.doc,.docx,.png,.jpg,.jpeg,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/png,image/jpeg"
  }
};

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

function statusLabel(locale: "zh" | "en", status: SubmissionItem["status"]) {
  const zh = { submitted: "已提交", approved: "已阅", rejected: "已拒绝" };
  const en = { submitted: "Submitted", approved: "Reviewed", rejected: "Rejected" };
  return (locale === "zh" ? zh : en)[status] || status;
}

function statusClass(status: SubmissionItem["status"]) {
  if (status === "approved") return "text-emerald-300";
  if (status === "rejected") return "text-rose-300";
  return "text-amber-200";
}

function emptyFileMessage(locale: "zh" | "en") {
  return locale === "zh" ? "不能提交空文件，请重新选择有效文件。" : "Empty files are not allowed. Please choose a valid file.";
}

export function TradeSubmissionsClient({
  locale,
  type
}: {
  locale: "zh" | "en";
  type: "trade_log" | "trade_strategy";
}) {
  const cfg = CONFIG[type];
  const [items, setItems] = React.useState<SubmissionItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [uploading, setUploading] = React.useState(false);
  const [files, setFiles] = React.useState<File[]>([]);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [userId, setUserId] = React.useState<string | null>(null);
  const [role, setRole] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState<SubmissionFile | null>(null);
  const [dragActive, setDragActive] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const uploadingRef = React.useRef(false);

  const load = React.useCallback(async (options?: { forceFresh?: boolean; silent?: boolean }) => {
    const forceFresh = Boolean(options?.forceFresh);
    const silent = Boolean(options?.silent);
    if (!silent) setLoading(true);
    if (forceFresh || !silent) setError(null);
    try {
      const listUrl = forceFresh ? `${cfg.listUrl}?fresh=1&_=${Date.now()}` : cfg.listUrl;
      const result = await fetchSystemJson<{ ok?: boolean; items?: SubmissionItem[] }>(listUrl, {
        fresh: forceFresh,
        dedupeKey: forceFresh ? `trade-submissions:${type}:list:fresh` : `trade-submissions:${type}:list`,
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
  }, [cfg.listUrl, type]);

  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const result = await fetchSystemJson<{ ok?: boolean; user?: { id?: string | null; role?: string | null } }>(
          "/api/system/me",
          {
            dedupeKey: "trade-submissions:me",
            retries: 1,
            retryBaseMs: 200,
            retryMaxMs: 1000
          }
        );
        const json = (result.body || {}) as any;
        if (!alive) return;
        if (result.ok && json?.ok) {
          setUserId(String(json.user?.id || ""));
          setRole(String(json.user?.role || ""));
        }
      } catch {
        // ignore
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  React.useEffect(() => {
    if (role && !LEARNER_ROLES.has(role)) return;
    void load({ forceFresh: false });
  }, [load, role]);

  useSystemRealtimeRefresh(
    () => {
      if (role && LEARNER_ROLES.has(role)) {
        void load({ forceFresh: true, silent: true });
      }
    },
    {
      tables: ["trade_submissions"],
      throttleMs: 3000,
      globalThrottleMs: 3800,
      dedupeKey: `trade-submissions:${type}:list`
    }
  );


  React.useEffect(() => {
    if (!editingId) return;
    if (type !== "trade_log") {
      setEditingId(null);
      return;
    }
    const current = items.find((it) => it.id === editingId);
    if (!current || current.status !== "submitted") {
      setEditingId(null);
    }
  }, [editingId, items, type]);

  const orderedItems = React.useMemo(() => {
    const list = [...items];
    list.sort((a, b) => {
      if (a.status === b.status) {
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      }
      if (a.status === "submitted") return -1;
      if (b.status === "submitted") return 1;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
    return list;
  }, [items]);

  const { pageItems, page, pageSize, setPage, setPageSize, pageCount, total } = usePagination(orderedItems, {
    deps: [type]
  });

  const handleFiles = React.useCallback(
    (next: File[]) => {
      if (!next.length) return;
      setError(null);
      if (next.length > MAX_FILES) {
        setError(locale === "zh" ? "最多只能上传3 个文件" : "Up to 3 files");
      }
      if (next.some((file) => !Number.isFinite(file.size) || file.size <= 0)) {
        setFiles([]);
        setError(emptyFileMessage(locale));
        return;
      }
      setFiles(next.slice(0, MAX_FILES));
    },
    [locale]
  );

  const onFilesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = Array.from(e.target.files || []);
    if (fileInputRef.current) fileInputRef.current.value = "";
    handleFiles(next);
  };

  const onDragOver = (e: React.DragEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    if (!dragActive) setDragActive(true);
  };

  const onDragLeave = () => {
    setDragActive(false);
  };

  const onDrop = (e: React.DragEvent<HTMLButtonElement>) => {
    e.preventDefault();
    setDragActive(false);
    handleFiles(Array.from(e.dataTransfer.files || []));
  };

  const startEdit = (submissionId: string) => {
    setEditingId(submissionId);
    setFiles([]);
    setError(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setFiles([]);
  };

  const upload = async () => {
    if (uploadingRef.current) return;
    if (!files.length) return;
    const replacing = type === "trade_log" && Boolean(editingId);
    const ok = window.confirm(
      replacing
        ? locale === "zh"
          ? "确认替换当前提交记录？"
          : "Replace the current submission?"
        : locale === "zh"
          ? "确认提交这些文件？"
          : "Submit these files?"
    );
    if (!ok) return;
    setError(null);
    setUploading(true);
    uploadingRef.current = true;
    try {
      const requestId = createClientRequestId(replacing && editingId ? `${type}_edit_${editingId}` : `${type}_new`);
      for (const file of files) {
        const name = (file.name || "").toLowerCase();
        const ext = name.includes(".") ? name.split(".").pop() || "" : "";
        const mime = (file.type || "").toLowerCase();
        if (!Number.isFinite(file.size) || file.size <= 0) {
          throw new Error(emptyFileMessage(locale));
        }
        if (!cfg.allowedExt.has(ext) && !cfg.allowedMime.has(mime)) {
          throw new Error(locale === "zh" ? "文件格式不支持" : "Unsupported file type");
        }
      }

      if (cfg.presignUrl) {
        const presignResult = await fetchSystemJson(cfg.presignUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            requestId,
            files: files.map((file) => ({
              name: file.name || "",
              size: file.size,
              type: file.type || ""
            })),
            submissionId: replacing ? editingId : undefined,
            replace: replacing
          }),
          retries: 1,
          retryBaseMs: 220,
          retryMaxMs: 1200
        });
        const presignJson = (presignResult.body || null) as any;
        if (!presignResult.ok || !presignJson?.ok) {
          throw new Error(presignJson?.error || presignResult.errorCode || "presign_failed");
        }

        const submissionId = String(presignJson.submissionId || "");
        const uploads = Array.isArray(presignJson.uploads) ? presignJson.uploads : [];
        if (!submissionId || uploads.length !== files.length) {
          throw new Error("presign_failed");
        }

        for (let i = 0; i < uploads.length; i += 1) {
          const uploadInfo = uploads[i];
          const file = files[i];
          const uploadUrl = String(uploadInfo.uploadUrl || "");
          if (!uploadUrl) throw new Error("upload_failed");
          const putRes = await fetch(uploadUrl, {
            method: "PUT",
            headers: { "Content-Type": file.type || "application/octet-stream" },
            body: file
          });
          if (!putRes.ok) throw new Error("upload_failed");
        }

        const finalizeResult = await fetchSystemJson(cfg.uploadUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            requestId,
            submissionId,
            replace: replacing,
            files: uploads.map((uploadInfo: any, idx: number) => ({
              bucket: uploadInfo.bucket,
              path: uploadInfo.path,
              fileName: uploadInfo.fileName || files[idx]?.name || "",
              size: files[idx]?.size || 0,
              mimeType: files[idx]?.type || null
            }))
          }),
          retries: 1,
          retryBaseMs: 220,
          retryMaxMs: 1200
        });
        const finalizeJson = (finalizeResult.body || null) as any;
        if (!finalizeResult.ok || !finalizeJson?.ok) {
          throw new Error(finalizeJson?.error || finalizeResult.errorCode || "upload_failed");
        }
      } else {
        const fd = new FormData();
        fd.set("requestId", requestId);
        files.forEach((file) => fd.append("files", file));
        if (replacing && editingId) fd.set("submissionId", editingId);
        const res = await fetch(cfg.uploadUrl, { method: "POST", body: fd });
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.ok) throw new Error(json?.error || "upload_failed");
      }
      setFiles([]);
      if (replacing) setEditingId(null);
      await load({ forceFresh: true });
    } catch (e: any) {
      setError(e?.message || "upload_failed");
    } finally {
      uploadingRef.current = false;
      setUploading(false);
    }
  };

  if (role && !LEARNER_ROLES.has(role)) {
    return (
      <div className="rounded-3xl border border-white/10 bg-white/5 p-6 text-white/70">
        {locale === "zh" ? "仅学员/数据采集员/教练可使用该功能。" : "Students, data collectors, and coaches only."}
      </div>
    );
  }

  const latestId = orderedItems[0]?.id;
  const isReplacing = type === "trade_log" && Boolean(editingId);
  const uploadHint =
    locale === "zh"
      ? `支持${type === "trade_log" ? "PDF/DOC/DOCX" : "PDF/DOC/DOCX/PNG/JPG"}，最多${MAX_FILES}个`
      : `Supports ${type === "trade_log" ? "PDF/DOC/DOCX" : "PDF/DOC/DOCX/PNG/JPG"}, max ${MAX_FILES}`;

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
        <div className="text-white/90 font-semibold text-xl">{locale === "zh" ? cfg.titleZh : cfg.titleEn}</div>
        <div className="mt-2 text-white/60 text-sm">{locale === "zh" ? cfg.descZh : cfg.descEn}</div>
      </div>

      <div className="rounded-3xl border border-white/10 bg-white/5 p-6 space-y-3">
        <div className="text-white/85 font-semibold">{locale === "zh" ? "上传文件" : "Upload"}</div>
        <div className="flex flex-wrap items-start gap-3">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={cfg.accept}
            onChange={onFilesChange}
            className="hidden"
          />
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
              data-drag={dragActive ? "1" : "0"}
              className="system-upload-card h-[140px] w-full sm:w-[260px]"
            >
              {files.length ? (
                <div className="system-upload-placeholder">
                  <FileText className="h-5 w-5 text-white/70" />
                  <div>
                    {locale === "zh" ? `已选择 ${files.length} 个文件` : `Selected ${files.length} files`}
                  </div>
                  <div className="text-xs text-white/50">{files[0]?.name || ""}</div>
                </div>
              ) : (
                <div className="system-upload-placeholder">
                  <div className="system-upload-plus">+</div>
                  <div>{locale === "zh" ? "点击上传文件" : "Upload files"}</div>
                </div>
              )}
            </button>
            <div className="system-upload-hint">{uploadHint}</div>
          </div>
          <button
            type="button"
            disabled={uploading || !files.length}
            onClick={upload}
            className="ml-auto rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-white hover:bg-white/15 disabled:opacity-50"
          >
            {uploading
              ? locale === "zh"
                ? "上传中..."
                : "Uploading..."
              : isReplacing
                ? locale === "zh"
                  ? "替换上传"
                  : "Replace upload"
                : locale === "zh"
                  ? "提交"
                  : "Submit"}
          </button>
        </div>
        {isReplacing ? (
          <div className="flex flex-wrap items-center gap-2 text-xs text-amber-200/80">
            <span>{locale === "zh" ? "正在修改当前提交记录" : "Editing the current submission."}</span>
            <button
              type="button"
              onClick={cancelEdit}
              className="rounded-lg border border-amber-200/30 bg-amber-400/10 px-2.5 py-1 text-xs text-amber-100 hover:bg-amber-400/20"
            >
              {locale === "zh" ? "取消修改" : "Cancel edit"}
            </button>
          </div>
        ) : null}
        {files.length ? (
          <div className="mt-2 space-y-1 text-sm text-white/70">
            {files.map((file) => (
              <div key={`${file.name}-${file.lastModified}`} className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-white/60" />
                <span className="truncate">{file.name}</span>
                <span className="text-xs text-white/45">{bytesToHuman(file.size)}</span>
                <button
                  type="button"
                  onClick={() => setFiles((prev) => prev.filter((item) => item !== file))}
                  className="ml-auto rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-white/70 hover:bg-white/10"
                >
                  {locale === "zh" ? "移除" : "Remove"}
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {error ? (
        <div className="rounded-3xl border border-rose-400/20 bg-rose-500/10 p-6 text-rose-100">{error}</div>
      ) : null}

      {loading ? (
        <div className="rounded-3xl border border-white/10 bg-white/5 p-6 text-white/60">
          {locale === "zh" ? "加载中..." : "Loading..."}
        </div>
      ) : null}

      {!loading && !orderedItems.length ? (
        <div className="rounded-3xl border border-white/10 bg-white/5 p-6 text-white/60">
          {locale === "zh" ? "暂无提交记录" : "No submissions yet."}
        </div>
      ) : null}

      <div className="space-y-4">
        {pageItems.map((it) => {
          const isLatest = it.id === latestId;
          const canEdit = type === "trade_log" && isLatest && it.status === "submitted";
          const editingRow = editingId === it.id;
          return (
            <div key={it.id} className="rounded-3xl border border-white/10 bg-white/5 p-6 space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <div className={`font-semibold ${statusClass(it.status)}`}>{statusLabel(locale, it.status)}</div>
                {it.rejection_reason ? (
                  <div className="text-xs text-rose-200/90">
                    {locale === "zh" ? "原因" : "Reason"}: {it.rejection_reason}
                  </div>
                ) : null}
                {it.review_note ? (
                  <div className="text-xs text-white/70">
                    {locale === "zh" ? "审批意见" : "Review note"}: {it.review_note}
                  </div>
                ) : null}
                <div className="ml-auto flex items-center gap-2 text-xs text-white/50">
                  <span>
                    <ClientDateTime value={it.created_at} />
                  </span>
                  {canEdit ? (
                    <button
                      type="button"
                      disabled={uploading}
                      onClick={() => startEdit(it.id)}
                      className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-white/80 hover:bg-white/10 disabled:opacity-50"
                    >
                      {editingRow ? (locale === "zh" ? "修改中" : "Editing") : locale === "zh" ? "修改" : "Edit"}
                    </button>
                  ) : null}
                </div>
              </div>
              <div className="space-y-2">
                {!it.files.length ? (
                  <div className="rounded-2xl border border-amber-300/20 bg-amber-400/10 px-3 py-2 text-sm text-amber-100/90">
                    {locale === "zh" ? "该记录没有检测到附件，请重新提交一次。" : "No uploaded files were found for this record. Please resubmit it."}
                  </div>
                ) : null}
                {it.files.map((file) => (
                  <div key={file.id} className="flex flex-wrap items-center gap-2 text-sm text-white/75">
                    <FileText className="h-4 w-4 text-white/60" />
                    <span className="max-w-[360px] truncate">{file.file_name}</span>
                    <span className="text-xs text-white/45">{bytesToHuman(file.size_bytes)}</span>
                    <button
                      type="button"
                      disabled={!file.url}
                      onClick={() => file.url && setPreview(file)}
                      className="ml-auto rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-white/80 hover:bg-white/10 disabled:opacity-50"
                    >
                      {locale === "zh" ? "预览" : "Preview"}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      {!loading && orderedItems.length ? (
        <PaginationControls
          total={total}
          page={page}
          pageSize={pageSize}
          pageCount={pageCount}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
          locale={locale}
        />
      ) : null}

      <PreviewModal
        file={
          preview
            ? { name: preview.file_name, url: preview.url, mimeType: preview.mime_type }
            : null
        }
        locale={locale}
        onClose={() => setPreview(null)}
      />
    </div>
  );
}
