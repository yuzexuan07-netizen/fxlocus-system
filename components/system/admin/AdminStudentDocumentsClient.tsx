"use client";

import React from "react";

import { ClientDateTime } from "@/components/system/ClientDateTime";
import { PreviewModal } from "@/components/system/PreviewModal";
import { PaginationControls } from "@/components/ui/PaginationControls";
import { saveWithPicker } from "@/lib/downloads/saveWithPicker";
import { fetchSystemJson } from "@/lib/system/clientFetch";
import { dispatchPendingDelta, dispatchSystemRealtime } from "@/lib/system/realtime";
import { useProgressiveList } from "@/lib/hooks/useProgressiveList";

type StudentInfo = {
  full_name?: string | null;
  email?: string | null;
  student_status?: string | null;
  status?: "active" | "frozen" | "deleted" | null;
};

type DocEntry = {
  id: string;
  student_id: string;
  doc_type: string;
  file_name: string;
  mime_type?: string | null;
  size_bytes?: number | null;
  created_at?: string | null;
  reviewed_at?: string | null;
  reviewed_by?: string | null;
  url?: string | null;
  student?: StudentInfo | null;
};

const TYPE_LABELS = {
  enrollment_form: { zh: "\u62a5\u540d\u8868", en: "Enrollment form" },
  trial_screenshot: { zh: "\u8bd5\u7528\u754c\u9762\u622a\u56fe", en: "Trial screenshot" },
  verification_image: {
    zh: "\u5b66\u4fe1\u7f51\u622a\u56fe/\u8eab\u4efd\u8bc1\u6b63\u53cd\u7167\u7247",
    en: "Academic record / ID card photos"
  }
};

type StudentDocGroup = {
  student_id: string;
  student?: StudentInfo | null;
  docs: {
    enrollment_form?: DocEntry;
    trial_screenshot?: DocEntry;
    verification_image: DocEntry[];
  };
  latest_at?: string | null;
  reviewed?: boolean;
};

function withProxyMode(url: string) {
  if (!url) return "";
  if (/[?&]mode=proxy(?:&|$)/.test(url)) return url;
  return `${url}${url.includes("?") ? "&" : "?"}mode=proxy`;
}

function LazyImageThumbnail({
  doc,
  locale,
  onOpen
}: {
  doc: DocEntry;
  locale: "zh" | "en";
  onOpen: (doc: DocEntry) => void;
}) {
  const buttonRef = React.useRef<HTMLButtonElement | null>(null);
  const [visible, setVisible] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const imageUrl = doc.url ? withProxyMode(doc.url) : "";

  React.useEffect(() => {
    if (!imageUrl || visible) return;
    const node = buttonRef.current;
    if (!node) return;
    if (typeof window === "undefined" || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setVisible(true);
        observer.disconnect();
      },
      { rootMargin: "180px 0px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [imageUrl, visible]);

  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={() => onOpen(doc)}
      className="group h-14 w-14 overflow-hidden rounded-lg border border-white/10 bg-black/20"
      title={doc.file_name}
    >
      {visible && imageUrl && !failed ? (
        <img
          src={imageUrl}
          alt={doc.file_name}
          className="h-full w-full object-cover transition group-hover:scale-105"
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="inline-flex h-full w-full items-center justify-center text-[10px] text-white/60">
          {locale === "zh" ? "\u9884\u89c8" : "Preview"}
        </span>
      )}
    </button>
  );
}

export function AdminStudentDocumentsClient({ locale }: { locale: "zh" | "en" }) {
  const [items, setItems] = React.useState<StudentDocGroup[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [warning, setWarning] = React.useState<string | null>(null);
  const [queryInput, setQueryInput] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(10);
  const [total, setTotal] = React.useState(0);
  const [busyStudentId, setBusyStudentId] = React.useState<string | null>(null);
  const [downloadingId, setDownloadingId] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState<{ name: string; url: string; mimeType?: string | null } | null>(null);
  const [reviewingStudentId, setReviewingStudentId] = React.useState<string | null>(null);
  const loadSeqRef = React.useRef(0);
  const recentMutationAtRef = React.useRef(0);

  const pageCount = Math.max(1, Math.ceil(Math.max(total, 0) / Math.max(pageSize, 1)));
  const {
    visibleItems: visibleRows,
    hasMore: hasMoreRows,
    sentinelRef: rowsSentinelRef
  } = useProgressiveList(items, {
    initial: 8,
    step: 6,
    enabled: items.length > 10,
    deps: [page, pageSize, query, total]
  });

  React.useEffect(() => {
    const t = window.setTimeout(() => {
      setPage(1);
      setQuery(queryInput.trim());
    }, 250);
    return () => window.clearTimeout(t);
  }, [queryInput]);

  React.useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  const load = React.useCallback(async (options?: { forceFresh?: boolean }) => {
    let forceFresh = Boolean(options?.forceFresh);
    if (!forceFresh && Date.now() - recentMutationAtRef.current < 15_000) {
      forceFresh = true;
    }
    const seq = ++loadSeqRef.current;
    if (!items.length) setLoading(true);
    setError(null);
    setWarning(null);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize)
      });
      if (query) params.set("keyword", query);
      if (forceFresh) params.set("fresh", "1");
      const dedupeKey = `admin-student-documents:list:${page}:${pageSize}:${query}`;
      const result = await fetchSystemJson<{ ok?: boolean; items?: StudentDocGroup[]; warning?: string; total?: number }>(
        `/api/system/admin/student-documents/list?${params.toString()}`,
        {
          fresh: forceFresh,
          dedupeKey,
          dedupeWindowMs: forceFresh ? 0 : 900,
          preferStale: !forceFresh,
          revalidateInBackground: !forceFresh,
          staleTtlMs: 5 * 60_000,
          retries: 2,
          retryBaseMs: 260,
          retryMaxMs: 1400
        }
      );
      const json = (result.body || null) as any;
      if (!result.ok || !json?.ok) throw new Error(json?.error || result.errorCode || "load_failed");
      if (seq !== loadSeqRef.current) return;
      setItems(Array.isArray(json.items) ? json.items : []);
      setTotal(Number(json?.total || 0));
      if (json?.warning) setWarning(String(json.warning));
    } catch (e: any) {
      if (seq !== loadSeqRef.current) return;
      setError(e?.message || "load_failed");
    } finally {
      if (seq !== loadSeqRef.current) return;
      setLoading(false);
    }
  }, [items.length, page, pageSize, query]);

  React.useEffect(() => {
    void load({ forceFresh: true });
  }, [load]);

  const removeStudentDocs = async (studentId: string) => {
    const ok = window.confirm(
      locale === "zh" ? "\u786e\u8ba4\u5220\u9664\u8be5\u5b66\u5458\u5168\u90e8\u8d44\u6599\uff1f" : "Delete all documents for this student?"
    );
    if (!ok) return;
    setBusyStudentId(studentId);
    setError(null);
    try {
      const result = await fetchSystemJson("/api/system/admin/student-documents/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ student_id: studentId }),
        dedupeKey: `admin-student-documents:delete:${studentId}`,
        dedupeWindowMs: 260,
        retries: 1,
        retryBaseMs: 220,
        retryMaxMs: 1200
      });
      const json = (result.body || null) as any;
      if (!result.ok || !json?.ok) throw new Error(json?.error || result.errorCode || "delete_failed");
      recentMutationAtRef.current = Date.now();
      dispatchPendingDelta({ studentDocuments: -1 });
      dispatchSystemRealtime({ table: "student_documents", action: "delete" });
      dispatchSystemRealtime({ table: "sidebar_counts", action: "update" });
      void load({ forceFresh: true });
    } catch (e: any) {
      setError(e?.message || "delete_failed");
    } finally {
      setBusyStudentId(null);
    }
  };

  const markReviewed = async (studentId: string) => {
    setReviewingStudentId(studentId);
    setError(null);
    try {
      const prevItem = items.find((item) => item.student_id === studentId) || null;
      const shouldDec = !prevItem?.reviewed;
      const result = await fetchSystemJson("/api/system/admin/student-documents/review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ student_id: studentId }),
        dedupeKey: `admin-student-documents:review:${studentId}`,
        dedupeWindowMs: 260,
        retries: 1,
        retryBaseMs: 220,
        retryMaxMs: 1200
      });
      const json = (result.body || null) as any;
      if (!result.ok || !json?.ok) throw new Error(json?.error || result.errorCode || "review_failed");
      setItems((prev) =>
        prev.map((item) => (item.student_id === studentId ? { ...item, reviewed: true } : item))
      );
      recentMutationAtRef.current = Date.now();
      if (shouldDec) dispatchPendingDelta({ studentDocuments: -1 });
      dispatchSystemRealtime({ table: "student_documents", action: "update" });
      dispatchSystemRealtime({ table: "sidebar_counts", action: "update" });
      void load({ forceFresh: true });
    } catch (e: any) {
      setError(e?.message || "review_failed");
    } finally {
      setReviewingStudentId(null);
    }
  };

  const downloadDoc = async (item: DocEntry) => {
    if (!item.url) return;
    setDownloadingId(item.id);
    setError(null);
    try {
      await saveWithPicker({
        url: item.url,
        filename: item.file_name || "document",
        mimeType: item.mime_type || null
      });
    } catch (e: any) {
      if (e?.name === "AbortError") return;
      setError(e?.message || "download_failed");
    } finally {
      setDownloadingId(null);
    }
  };

  const openPreview = (doc: DocEntry) => {
    if (!doc.url) return;
    const previewUrl = isImageDoc(doc) ? withProxyMode(doc.url) : doc.url;
    setPreview({ name: doc.file_name, url: previewUrl, mimeType: doc.mime_type || null });
  };

  const isImageDoc = (doc: DocEntry) => Boolean(doc.mime_type && doc.mime_type.startsWith("image/"));

  const renderEnrollment = (doc?: DocEntry) => {
    if (!doc) return <div className="text-xs text-white/40">-</div>;
    return (
      <div className="space-y-2">
        <div className="max-w-[220px] truncate text-white/85" title={doc.file_name}>
          {doc.file_name || "-"}
        </div>
        <button
          type="button"
          disabled={!doc.url || downloadingId === doc.id}
          onClick={() => downloadDoc(doc)}
          className="px-2.5 py-1 rounded-lg border border-white/10 bg-white/5 text-xs text-white/80 hover:bg-white/10 disabled:opacity-50"
        >
          {locale === "zh" ? "\u4e0b\u8f7d" : "Download"}
        </button>
      </div>
    );
  };

  const renderThumbnail = (doc?: DocEntry) => {
    if (!doc) return <div className="text-xs text-white/40">-</div>;
    if (!doc.url || !isImageDoc(doc)) {
      return (
        <button
          type="button"
          onClick={() => openPreview(doc)}
          className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-white/70 hover:bg-white/10"
          title={doc.file_name}
        >
          {doc.file_name || "Preview"}
        </button>
      );
    }
    return <LazyImageThumbnail doc={doc} locale={locale} onOpen={openPreview} />;
  };

  const renderThumbnailList = (docs: DocEntry[]) => {
    if (!docs.length) return <div className="text-xs text-white/40">-</div>;
    return (
      <div className="flex flex-wrap gap-2">
        {docs.map((doc) => (
          <div key={doc.id}>{renderThumbnail(doc)}</div>
        ))}
      </div>
    );
  };

  const accountStatusLabel = (status?: string | null) => {
    if (status === "frozen") return locale === "zh" ? "\u51bb\u7ed3" : "Frozen";
    if (status === "deleted") return locale === "zh" ? "\u5df2\u5220\u9664" : "Deleted";
    if (status === "active") return locale === "zh" ? "\u6b63\u5e38" : "Active";
    return "-";
  };

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
        <div className="text-white/90 font-semibold text-xl">
          {locale === "zh" ? "\u5b66\u5458\u8d44\u6599" : "Student documents"}
        </div>
        <div className="mt-2 text-white/60 text-sm">
          {locale === "zh"
            ? "\u67e5\u770b\u65b0\u5b66\u5458\u4e0a\u4f20\u7684\u8d44\u6599\uff0c\u53ef\u9884\u89c8\u6216\u5220\u9664\u3002"
            : "Review student uploads, preview or delete."}
        </div>
      </div>

      <div className="rounded-3xl border border-white/10 bg-white/5 p-4 flex flex-wrap items-center gap-3">
        <input
          value={queryInput}
          onChange={(e) => setQueryInput(e.target.value)}
          className="flex-1 min-w-[220px] rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/85"
          placeholder={locale === "zh" ? "\u641c\u7d22\uff1a\u59d3\u540d/\u90ae\u7bb1/\u6587\u4ef6\u540d" : "Search: name/email/file"}
        />
      </div>

      {error ? (
        <div className="rounded-3xl border border-rose-400/20 bg-rose-500/10 p-6 text-rose-100">{error}</div>
      ) : null}
      {warning ? (
        <div className="rounded-3xl border border-sky-400/20 bg-sky-500/10 p-5 text-sm text-sky-100">
          {locale === "zh"
            ? "\u5b66\u5458\u8d44\u6599\u8868\u5c1a\u672a\u521d\u59cb\u5316\uff0c\u8bf7\u5e94\u7528\u6700\u65b0 D1 schema\uff08d1/schema.sql\uff09\u3002"
            : "Student documents table is not initialized. Apply the latest D1 schema (d1/schema.sql)."}
        </div>
      ) : null}

      {loading ? (
        <div className="rounded-3xl border border-white/10 bg-white/5 p-6 text-white/60">
          {locale === "zh" ? "\u52a0\u8f7d\u4e2d..." : "Loading..."}
        </div>
      ) : null}

      {!loading && !items.length ? (
        <div className="rounded-3xl border border-white/10 bg-white/5 p-6 text-white/60">
          {locale === "zh" ? "\u6682\u65e0\u8d44\u6599" : "No documents yet."}
        </div>
      ) : null}

      <div className="rounded-3xl border border-white/10 bg-white/5 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm student-docs-table">
            <thead className="text-xs text-white/50">
              <tr className="border-b border-white/10">
                <th className="px-6 py-3 text-left min-w-[220px]">{locale === "zh" ? "\u5b66\u5458" : "Student"}</th>
                <th className="px-6 py-3 text-left min-w-[90px] whitespace-nowrap">
                  {locale === "zh" ? "\u72b6\u6001" : "Status"}
                </th>
                <th className="px-6 py-3 text-left">
                  {locale === "zh" ? TYPE_LABELS.enrollment_form.zh : TYPE_LABELS.enrollment_form.en}
                </th>
                <th className="px-6 py-3 text-left">
                  {locale === "zh" ? TYPE_LABELS.trial_screenshot.zh : TYPE_LABELS.trial_screenshot.en}
                </th>
                <th className="px-6 py-3 text-left">
                  {locale === "zh" ? TYPE_LABELS.verification_image.zh : TYPE_LABELS.verification_image.en}
                </th>
                <th className="px-6 py-3 text-left">{locale === "zh" ? "\u6700\u8fd1\u4e0a\u4f20" : "Latest upload"}</th>
                <th className="px-6 py-3 text-right">{locale === "zh" ? "\u64cd\u4f5c" : "Actions"}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {visibleRows.map((item) => {
                const student = item.student || {};
                const enrollmentForm = item.docs.enrollment_form;
                const trialScreenshot = item.docs.trial_screenshot;
                const verificationImages = item.docs.verification_image || [];
                const accountStatus = accountStatusLabel(student.status || "active");
                const reviewed = item.reviewed ?? false;
                return (
                  <tr key={item.student_id} className="hover:bg-white/5">
                    <td className="px-6 py-4 text-white/85 align-top whitespace-normal min-w-[220px] max-w-none">
                      <div className="space-y-1">
                        <div className="font-semibold whitespace-nowrap">
                          <span className="system-name">{student.full_name || "-"}</span>
                        </div>
                        <div className="text-xs text-white/50 max-w-[220px] truncate">{student.email || "-"}</div>
                        <div className="text-xs text-white/45 max-w-[220px] truncate">{student.student_status || "-"}</div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-white/70 whitespace-nowrap min-w-[90px]">{accountStatus}</td>
                    <td className="px-6 py-4 text-white/70">{renderEnrollment(enrollmentForm)}</td>
                    <td className="px-6 py-4 text-white/70">{renderThumbnail(trialScreenshot)}</td>
                    <td className="px-6 py-4 text-white/70">{renderThumbnailList(verificationImages)}</td>
                    <td className="px-6 py-4 text-white/60">
                      <ClientDateTime value={item.latest_at} fallback="-" />
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          disabled={reviewed || reviewingStudentId === item.student_id}
                          onClick={() => markReviewed(item.student_id)}
                          className="px-3 py-1.5 rounded-xl border border-white/10 bg-white/5 text-xs text-white/80 hover:bg-white/10 disabled:opacity-50"
                        >
                          {reviewed
                            ? locale === "zh"
                              ? "\u5df2\u9605"
                              : "Read"
                            : reviewingStudentId === item.student_id
                              ? locale === "zh"
                                ? "\u5904\u7406\u4e2d..."
                                : "Processing..."
                              : locale === "zh"
                                ? "\u6807\u8bb0\u5df2\u9605"
                                : "Mark read"}
                        </button>
                        <button
                          type="button"
                          disabled={busyStudentId === item.student_id}
                          onClick={() => removeStudentDocs(item.student_id)}
                          className="px-3 py-1.5 rounded-xl bg-rose-500/10 border border-rose-400/20 text-rose-100 hover:bg-rose-500/15 disabled:opacity-50"
                        >
                          {busyStudentId === item.student_id
                            ? locale === "zh"
                              ? "\u5904\u7406\u4e2d..."
                              : "Processing..."
                            : locale === "zh"
                              ? "\u5220\u9664"
                              : "Delete"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {hasMoreRows ? (
                <tr>
                  <td colSpan={7} className="px-6 py-4 text-center text-xs text-white/45">
                    <div ref={rowsSentinelRef}>
                      {locale === "zh" ? "\u4e0b\u62c9\u7ee7\u7eed\u52a0\u8f7d..." : "Scroll to load more..."}
                    </div>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {!loading && total > 0 ? (
          <PaginationControls
            total={total}
            page={page}
            pageSize={pageSize}
            pageCount={pageCount}
            onPageChange={setPage}
            onPageSizeChange={(next) => {
              setPageSize(next);
              setPage(1);
            }}
            locale={locale}
          />
        ) : null}
      </div>

      <PreviewModal
        file={preview ? { name: preview.name, url: preview.url, mimeType: preview.mimeType } : null}
        locale={locale}
        onClose={() => setPreview(null)}
      />
    </div>
  );
}
