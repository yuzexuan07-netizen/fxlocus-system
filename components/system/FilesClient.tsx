"use client";

import React from "react";

import { AdminFilesClient } from "@/components/system/admin/AdminFilesClient";
import { ClientDateTime } from "@/components/system/ClientDateTime";
import { PreviewModal } from "@/components/system/PreviewModal";
import { saveWithPicker } from "@/lib/downloads/saveWithPicker";
import { fetchSystemJson } from "@/lib/system/clientFetch";
import { isSuperAdmin, type SystemRole } from "@/lib/system/roles";
import { useSystemRealtimeRefresh } from "@/lib/system/useSystemRealtimeRefresh";

type MeResponse =
  | { ok: true; user: { role: SystemRole } }
  | { ok: false; error: string };

type FileItem = {
  id: string;
  category: string;
  name: string;
  description?: string | null;
  size_bytes: number;
  mime_type?: string | null;
  created_at: string;
  can_download: boolean;
  request_status: "none" | "requested" | "approved" | "rejected";
  rejection_reason?: string | null;
};

type LoadFilesOptions = {
  fresh?: boolean;
};

const ONBOARDING_FILE_SPECS = [
  {
    key: "stage-one",
    zh: "第一阶段",
    en: "Stage 1",
    keywords: ["第一阶段", "stage1", "stage 1", "phase1", "phase 1"]
  },
  {
    key: "mt4",
    zh: "MT4软件操作",
    en: "MT4 software guide",
    keywords: ["mt4软件操作", "mt4操作", "mt4使用", "mt4教程", "software guide"]
  },
  {
    key: "portable",
    zh: "绿色免安装",
    en: "Portable green install package",
    keywords: ["绿色免安装", "免安装", "绿色版", "portable"]
  },
  {
    key: "enrollment-form",
    zh: "报名表",
    en: "Enrollment form",
    keywords: ["报名表", "报名", "enrollment form"]
  }
] as const;

const EXT_BY_MIME: Record<string, string> = {
  "application/pdf": "pdf",
  "application/zip": "zip",
  "application/json": "json",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "text/plain": "txt",
  "text/markdown": "md",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/bmp": "bmp",
  "image/avif": "avif",
  "image/heic": "heic",
  "image/heif": "heif",
  "video/mp4": "mp4"
};

function sanitizeFilename(value: string) {
  return value.replace(/[\\/:*?"<>|]+/g, "-").trim();
}

function resolveFileName(file: Pick<FileItem, "id" | "name">) {
  const raw = String(file.name || "").trim();
  if (raw) return raw;
  const suffix = String(file.id || "").trim().slice(0, 8);
  return suffix ? `file-${suffix}` : "download";
}

function normalizeSearchText(value: string) {
  return value.toLowerCase().replace(/\s+/g, "");
}

function findOnboardingFile(items: FileItem[], spec: (typeof ONBOARDING_FILE_SPECS)[number]) {
  return items.find((file) => {
    const hay = normalizeSearchText(`${file.name || ""} ${file.description || ""} ${file.category || ""}`);
    return spec.keywords.some((keyword) => hay.includes(normalizeSearchText(keyword)));
  });
}

function buildDownloadName(file: FileItem) {
  const baseName = sanitizeFilename(resolveFileName(file));
  const hasExt = /\.[a-z0-9]{1,6}$/i.test(baseName);
  if (hasExt) return baseName;
  const ext = file.mime_type ? EXT_BY_MIME[file.mime_type] : "";
  return ext ? `${baseName}.${ext}` : baseName;
}

export function FilesClient({ locale }: { locale: "zh" | "en" }) {
  const [role, setRole] = React.useState<SystemRole | null>(null);
  const [userId, setUserId] = React.useState<string | null>(null);
  const [items, setItems] = React.useState<FileItem[]>([]);
  const [documentsSubmitted, setDocumentsSubmitted] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [previewingId, setPreviewingId] = React.useState<string | null>(null);
  const [requestingById, setRequestingById] = React.useState<Record<string, boolean>>({});
  const [preview, setPreview] = React.useState<{ name: string; url: string; mimeType?: string | null } | null>(null);
  const displayItems = React.useMemo(() => {
    return [...items].sort((a, b) => {
      const at = new Date(a.created_at || 0).getTime();
      const bt = new Date(b.created_at || 0).getTime();
      return bt - at;
    });
  }, [items]);
  const loadFiles = React.useCallback(async (options: LoadFilesOptions = {}) => {
    const fresh = Boolean(options.fresh);
    const result = await fetchSystemJson<{ ok?: boolean; files?: FileItem[]; documentsSubmitted?: boolean }>("/api/system/files/list", {
      dedupeKey: "system-files:list",
      fresh,
      skipInflight: fresh,
      preferStale: !fresh,
      revalidateInBackground: !fresh,
      retries: 2,
      retryBaseMs: 260,
      retryMaxMs: 1500
    });
    if (!result.ok) throw new Error(result.errorCode || "load_failed");
    const body = (result.body || {}) as any;
    setItems(Array.isArray(body.files) ? body.files : []);
    setDocumentsSubmitted(Boolean(body.documentsSubmitted));
  }, []);

  const setFilesRequesting = React.useCallback((fileIds: string[], requesting: boolean) => {
    const ids = new Set(fileIds.map((id) => String(id || "")).filter(Boolean));
    if (!ids.size) return;
    setRequestingById((prev) => {
      const next = { ...prev };
      for (const id of ids) {
        if (requesting) next[id] = true;
        else delete next[id];
      }
      return next;
    });
  }, []);

  const markFilesRequested = React.useCallback((fileIds: string[]) => {
    const ids = new Set(fileIds.map((id) => String(id || "")).filter(Boolean));
    if (!ids.size) return;
    setItems((prev) =>
      prev.map((item) =>
        ids.has(String(item.id)) && !item.can_download
          ? { ...item, request_status: "requested", rejection_reason: null }
          : item
      )
    );
  }, []);

  const refresh = React.useCallback(() => {
    if (!role || isSuperAdmin(role)) return;
    loadFiles().catch(() => null);
  }, [loadFiles, role]);

  useSystemRealtimeRefresh(refresh, {
    tables: ["files", "file_permissions", "file_access_requests"],
    throttleMs: 3000,
    globalThrottleMs: 3800,
    dedupeKey: "system-files:list"
  });

  React.useEffect(() => {
    let alive = true;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const meResult = await fetchSystemJson<MeResponse>("/api/system/me", {
          dedupeKey: "system-files:me",
          retries: 1,
          retryBaseMs: 200,
          retryMaxMs: 1000
        });
        const meJson = (meResult.body || null) as MeResponse | null;
        if (!alive) return;
        if (!meResult.ok || !meJson?.ok) {
          throw new Error((meJson as any)?.error || meResult.errorCode || "load_failed");
        }

        const nextRole = meJson.user.role;
        setRole(nextRole);
        setUserId(String((meJson as any).user?.id || ""));

        if (isSuperAdmin(nextRole)) {
          setLoading(false);
          return;
        }

        await loadFiles();
      } catch (e: any) {
        if (!alive) return;
        setError(e?.message || "load_failed");
      } finally {
        if (alive) setLoading(false);
      }
    };

    load();
    return () => {
      alive = false;
    };
  }, [loadFiles]);

  const download = async (file: FileItem) => {
    const ok = window.confirm(locale === "zh" ? "确认下载该文件？" : "Download this file?");
    if (!ok) return;
    const encodedId = encodeURIComponent(String(file.id || ""));
    if (!encodedId) return;
    await saveWithPicker({
      url: `/api/system/files/${encodedId}/download?disposition=attachment`,
      filename: buildDownloadName(file),
      mimeType: file.mime_type || undefined
    });
  };

  const openPreview = (item: FileItem) => {
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

  const requestAccess = async (fileId: string) => {
    const ok = window.confirm(locale === "zh" ? "确认申请该文件权限？" : "Request access to this file?");
    if (!ok) return;
    setError(null);
    setFilesRequesting([fileId], true);
    try {
      const result = await fetchSystemJson("/api/system/files/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fileId }),
        retries: 1,
        retryBaseMs: 220,
        retryMaxMs: 1200
      });
      if (!result.ok) throw new Error(result.errorCode || "request_failed");
      markFilesRequested([fileId]);
      await loadFiles({ fresh: true });
    } catch (e: any) {
      setError(e?.message || "request_failed");
    } finally {
      setFilesRequesting([fileId], false);
    }
  };

  const onboardingFiles = React.useMemo(
    () =>
      ONBOARDING_FILE_SPECS.map((spec) => ({
        ...spec,
        file: findOnboardingFile(displayItems, spec)
      })),
    [displayItems]
  );

  const requestableOnboardingFiles = React.useMemo(
    () =>
      onboardingFiles
        .map((item) => item.file)
        .filter((file): file is FileItem => {
          if (!file?.id) return false;
          return !file.can_download && file.request_status !== "requested";
        }),
    [onboardingFiles]
  );

  const requestingOnboarding = React.useMemo(
    () => requestableOnboardingFiles.some((file) => Boolean(requestingById[file.id])),
    [requestableOnboardingFiles, requestingById]
  );

  const requestOnboardingFiles = async () => {
    if (!requestableOnboardingFiles.length) return;
    const ok = window.confirm(
      locale === "zh"
        ? "确认申请新手指引所需的资料权限？"
        : "Request access to all onboarding files?"
    );
    if (!ok) return;
    setError(null);
    const requestedIds = requestableOnboardingFiles.map((file) => file.id);
    setFilesRequesting(requestedIds, true);
    try {
      for (const file of requestableOnboardingFiles) {
        const result = await fetchSystemJson("/api/system/files/request", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ fileId: file.id }),
          retries: 1,
          retryBaseMs: 220,
          retryMaxMs: 1200
        });
        if (!result.ok) throw new Error(result.errorCode || "request_failed");
      }
      markFilesRequested(requestedIds);
      await loadFiles({ fresh: true });
    } catch (e: any) {
      setError(e?.message || "request_failed");
    } finally {
      setFilesRequesting(requestedIds, false);
    }
  };

  React.useEffect(() => {
    if (!userId || !role || isSuperAdmin(role)) return;
    loadFiles().catch(() => null);
  }, [loadFiles, role, userId]);

  if (role && isSuperAdmin(role)) return <AdminFilesClient locale={locale} />;

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
        <div className="text-white/90 font-semibold text-xl">{locale === "zh" ? "文件" : "Files"}</div>
        <div className="mt-2 text-white/60 text-sm">
          {locale === "zh"
            ? "可查看全部资料，未授权的文件可提交申请；通过后可下载。" : "Browse files. Request access for locked items, and download after approval."}
        </div>
      </div>

      {!loading && role && !isSuperAdmin(role) && !documentsSubmitted ? (
        <section className="rounded-3xl border border-emerald-300/25 bg-[radial-gradient(circle_at_top_left,rgba(52,211,153,0.24),transparent_38%),linear-gradient(135deg,rgba(16,185,129,0.12),rgba(15,23,42,0.74))] p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-100/60">
                {locale === "zh" ? "新手资料申请" : "Onboarding files"}
              </div>
              <div className="mt-2 text-xl font-semibold text-white">
                {locale === "zh" ? "先申请这 4 个资料" : "Request these 4 files first"}
              </div>
              <div className="mt-2 max-w-2xl text-sm leading-7 text-white/68">
                {locale === "zh"
                  ? "权限通过后，先学习资料内容；报名表下载填写后，再去资料上传菜单提交。"
                  : "After approval, study the files. Download and fill the enrollment form, then submit it in Uploads."}
              </div>
            </div>
            <button
              type="button"
              onClick={requestOnboardingFiles}
              disabled={!requestableOnboardingFiles.length || requestingOnboarding}
              className="rounded-2xl border border-emerald-200/35 bg-emerald-300/90 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {locale === "zh" ? "一键申请未授权资料" : "Request missing access"}
            </button>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {onboardingFiles.map((item) => {
              const file = item.file;
              const label = locale === "zh" ? item.zh : item.en;
              const status = !file
                ? locale === "zh"
                  ? "未找到"
                  : "Missing"
                : file.can_download
                  ? locale === "zh"
                    ? "已授权"
                    : "Approved"
                  : file.request_status === "requested"
                    ? locale === "zh"
                      ? "已申请"
                      : "Requested"
                    : locale === "zh"
                      ? "待申请"
                      : "Request needed";
              return (
                <div key={item.key} className="rounded-2xl border border-white/10 bg-black/18 p-4">
                  <div className="text-sm font-semibold text-white">{label}</div>
                  <div className="mt-2 text-xs text-white/54">{file ? resolveFileName(file) : "-"}</div>
                  <div className="mt-3 flex items-center gap-2">
                    <span className="rounded-full border border-white/12 bg-white/10 px-2.5 py-1 text-xs text-white/72">
                      {status}
                    </span>
                    {file && !file.can_download && file.request_status !== "requested" ? (
                      <button
                        type="button"
                        onClick={() => requestAccess(file.id)}
                        disabled={Boolean(requestingById[file.id])}
                        className="ml-auto rounded-full border border-white/12 bg-white/10 px-2.5 py-1 text-xs text-white/78 hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {locale === "zh" ? "申请" : "Request"}
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {loading ? (
        <div className="rounded-3xl border border-white/10 bg-white/5 p-6 text-white/60">
          {locale === "zh" ? "加载中..." : "Loading..."}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-3xl border border-rose-400/20 bg-rose-500/10 p-6 text-rose-100">
          {locale === "zh" ? "加载失败：" : "Failed: "} {error}
        </div>
      ) : null}

      {!loading && !displayItems.length ? (
        <div className="rounded-3xl border border-white/10 bg-white/5 p-6 text-white/60">
          {locale === "zh" ? "暂无文件" : "No files."}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {displayItems.map((f) => (
          <div key={f.id} className="rounded-3xl border border-white/10 bg-white/5 p-6">
            <div className="text-xs text-white/50">{f.category}</div>
            <div className="mt-2 text-white/90 font-semibold">{resolveFileName(f)}</div>
            {f.description ? <div className="mt-2 text-sm text-white/65 leading-6">{f.description}</div> : null}

            {!f.can_download ? (
              <div className="mt-3 text-xs text-white/55">
                {f.request_status === "requested"
                  ? locale === "zh"
                    ? "已申请，等待审批" : "Requested (pending)"
                  : f.request_status === "rejected"
                    ? locale === "zh"
                      ? `已拒绝：${f.rejection_reason || "-"}`
                      : `Rejected: ${f.rejection_reason || "-"}`
                    : locale === "zh"
                      ? "未授权，可申请权限" : "Locked. You can request access."}
              </div>
            ) : null}

            <div className="mt-4 flex items-center gap-2">
              {f.can_download ? (
                <>
                  <button
                    type="button"
                    className="px-3 py-1.5 rounded-xl bg-white/5 border border-white/10 text-white/80 hover:bg-white/10 disabled:opacity-50"
                    onClick={() => openPreview(f)}
                    disabled={previewingId === f.id}
                  >
                    {locale === "zh" ? "预览" : "Preview"}
                  </button>
                  <button
                    type="button"
                    className="px-3 py-1.5 rounded-xl bg-white/10 border border-white/20 text-white hover:bg-white/15"
                    onClick={() => download(f)}
                  >
                    {locale === "zh" ? "下载" : "Download"}
                  </button>
                </>
              ) : f.request_status === "requested" ? (
                <span className="text-xs text-white/50">{locale === "zh" ? "等待审批..." : "Pending..."}</span>
              ) : (
                <button
                  type="button"
                  className="px-3 py-1.5 rounded-xl bg-white/5 border border-white/10 text-white/80 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={() => requestAccess(f.id)}
                  disabled={Boolean(requestingById[f.id])}
                >
                  {locale === "zh" ? "申请权限" : "Request access"}
                </button>
              )}

              <div className="ml-auto text-xs text-white/45">
                <ClientDateTime value={f.created_at} format="date" />
              </div>
            </div>
          </div>
        ))}
      </div>
      <PreviewModal
        file={preview ? { name: preview.name, url: preview.url, mimeType: preview.mimeType } : null}
        locale={locale}
        onClose={() => setPreview(null)}
      />
    </div>
  );
}
