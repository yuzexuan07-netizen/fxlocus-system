"use client";

import React from "react";

import { PreviewModal } from "@/components/system/PreviewModal";
import { Link } from "@/i18n/navigation";
import { fetchSystemJson } from "@/lib/system/clientFetch";

type UploadNotice = { type: "success" | "error"; message: string };
type LocalFile = { id: string; file: File; url: string };

const DOC_TYPES = {
  enrollment_form: {
    zh: "\u62a5\u540d\u8868",
    en: "Enrollment form",
    accept:
      ".doc,.docx,.pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/pdf",
    multiple: false
  },
  trial_screenshot: {
    zh: "\u8bd5\u7528\u754c\u9762\u4fe1\u606f\u622a\u56fe",
    en: "Trial UI screenshot",
    accept: "image/*",
    multiple: false
  },
  verification_image: {
    zh: "\u5b66\u4fe1\u7f51\u622a\u56fe/\u8eab\u4efd\u8bc1\u6b63\u53cd\u7167\u7247",
    en: "Academic record / ID card photos",
    accept: "image/*",
    multiple: true
  }
} as const;

type DocTypeKey = keyof typeof DOC_TYPES;

const emptySelection: Record<DocTypeKey, LocalFile[]> = {
  enrollment_form: [],
  trial_screenshot: [],
  verification_image: []
};

function fileListToArray(list: FileList | null) {
  if (!list) return [] as File[];
  return Array.from(list);
}

function makeId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return (crypto as Crypto).randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isImage(file: File) {
  return Boolean(file.type && file.type.startsWith("image/"));
}

export function StudentDocumentsUploadClient({ locale }: { locale: "zh" | "en" }) {
  const [submitting, setSubmitting] = React.useState(false);
  const [notice, setNotice] = React.useState<UploadNotice | null>(null);
  const [selected, setSelected] = React.useState<Record<DocTypeKey, LocalFile[]>>(emptySelection);
  const selectedRef = React.useRef(selected);
  const [preview, setPreview] = React.useState<{
    name: string;
    url: string;
    mimeType?: string | null;
  } | null>(null);
  const [dragTarget, setDragTarget] = React.useState<DocTypeKey | null>(null);
  const submittingRef = React.useRef(false);

  React.useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  React.useEffect(() => {
    return () => {
      Object.values(selectedRef.current).flat().forEach((item) => {
        URL.revokeObjectURL(item.url);
      });
    };
  }, []);

  const addFiles = React.useCallback((docType: DocTypeKey, files: File[]) => {
    if (!files.length) return;
    setSelected((prev) => {
      const next = { ...prev };
      const mapped = files.map((file) => ({
        id: makeId(),
        file,
        url: URL.createObjectURL(file)
      }));
      const limit = docType === "verification_image" ? 3 : Number.POSITIVE_INFINITY;
      if (!DOC_TYPES[docType].multiple) {
        prev[docType].forEach((item) => URL.revokeObjectURL(item.url));
        next[docType] = mapped.slice(-1);
      } else {
        const combined = [...prev[docType], ...mapped];
        if (combined.length > limit) {
          combined.slice(limit).forEach((item) => URL.revokeObjectURL(item.url));
          next[docType] = combined.slice(0, limit);
        } else {
          next[docType] = combined;
        }
      }
      return next;
    });
  }, []);

  const removeFile = React.useCallback((docType: DocTypeKey, id: string) => {
    setSelected((prev) => {
      const current = prev[docType];
      const remove = current.find((item) => item.id === id);
      if (remove) URL.revokeObjectURL(remove.url);
      return { ...prev, [docType]: current.filter((item) => item.id !== id) };
    });
  }, []);

  const clearAll = React.useCallback(() => {
    setSelected((prev) => {
      Object.values(prev).flat().forEach((item) => URL.revokeObjectURL(item.url));
      return { ...emptySelection };
    });
  }, []);

  const requiredReady =
    selected.enrollment_form.length === 1 &&
    selected.trial_screenshot.length === 1 &&
    selected.verification_image.length > 0;

  const submitAll = React.useCallback(async () => {
    if (!requiredReady || submittingRef.current) {
      setNotice({
        type: "error",
        message:
          locale === "zh"
            ? "\u4e09\u9879\u8d44\u6599\u90fd\u5fc5\u987b\u4e0a\u4f20\u5b8c\u6210"
            : "All three document types are required."
      });
      return;
    }
    setNotice(null);
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const form = new FormData();
      const requestId =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `student_docs_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      form.append("requestId", requestId);
      (Object.keys(DOC_TYPES) as DocTypeKey[]).forEach((docType) => {
        selected[docType].forEach((item) => form.append(docType, item.file));
      });

      const result = await fetchSystemJson<{ ok?: boolean; error?: string }>("/api/system/student-documents/upload", {
        method: "POST",
        body: form,
        dedupeKey: `student-documents:upload:${requestId}`,
        dedupeWindowMs: 1200,
        retries: 1,
        retryBaseMs: 260,
        retryMaxMs: 1200
      });
      const json = (result.body || null) as any;
      if (!result.ok || !json?.ok) {
        throw new Error(json?.error || result.errorCode || "upload_failed");
      }
      clearAll();
      setNotice({
        type: "success",
        message:
          locale === "zh"
            ? "\u63d0\u4ea4\u6210\u529f\uff0c\u5df2\u53d1\u9001\u7ed9\u56e2\u961f\u957f/\u6559\u7ec3/\u8d85\u7ba1"
            : "Submitted successfully."
      });
    } catch (err: any) {
      setNotice({
        type: "error",
        message: err?.message || (locale === "zh" ? "\u63d0\u4ea4\u5931\u8d25" : "Upload failed")
      });
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }, [clearAll, locale, requiredReady, selected]);

  const makeTileLabel = (docType: DocTypeKey) => {
    const count = selected[docType].length;
    if (!count) return locale === "zh" ? "\u70b9\u51fb\u4e0a\u4f20\u6587\u4ef6" : "Click to upload file";
    if (DOC_TYPES[docType].multiple) {
      return locale === "zh" ? "\u7ee7\u7eed\u6dfb\u52a0" : "Add more";
    }
    return locale === "zh" ? "\u70b9\u51fb\u66ff\u6362" : "Click to replace";
  };

  const renderUploadTile = (docType: DocTypeKey) => {
    const config = DOC_TYPES[docType];
    const inputId = `doc-upload-${docType}`;
    return (
      <>
        <input
          id={inputId}
          type="file"
          accept={config.accept}
          multiple={config.multiple}
          disabled={submitting}
          onChange={(e) => {
            const files = fileListToArray(e.target.files);
            e.currentTarget.value = "";
            addFiles(docType, files);
          }}
          className="hidden"
        />
        <label
          htmlFor={inputId}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
            if (dragTarget !== docType) setDragTarget(docType);
          }}
          onDragLeave={() => {
            if (dragTarget === docType) setDragTarget(null);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setDragTarget(null);
            addFiles(docType, Array.from(e.dataTransfer.files || []));
          }}
          data-drag={dragTarget === docType ? "1" : "0"}
          className="flex h-28 cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-white/25 bg-white/5 text-sm text-white/80 transition hover:border-white/45 hover:bg-white/10"
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white/20 text-lg text-white/70">
            +
          </div>
          <div>{makeTileLabel(docType)}</div>
        </label>
      </>
    );
  };

  const renderDocList = (docType: DocTypeKey) => {
    const list = selected[docType];
    if (!list.length) return null;
    return (
      <div className="space-y-2">
        {list.map((item) => (
          <div
            key={item.id}
            className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-2"
          >
            <div className="min-w-0 flex-1 text-sm text-white/80 truncate">{item.file.name}</div>
            <button
              type="button"
              onClick={() =>
                setPreview({ name: item.file.name, url: item.url, mimeType: item.file.type || null })
              }
              className="px-2.5 py-1 rounded-lg border border-white/10 bg-white/5 text-xs text-white/75 hover:bg-white/10"
            >
              {locale === "zh" ? "\u9884\u89c8" : "Preview"}
            </button>
            <button
              type="button"
              onClick={() => removeFile(docType, item.id)}
              className="px-2.5 py-1 rounded-lg border border-rose-400/30 bg-rose-500/10 text-xs text-rose-100 hover:bg-rose-500/20"
            >
              {locale === "zh" ? "\u79fb\u9664" : "Remove"}
            </button>
          </div>
        ))}
      </div>
    );
  };

  const renderImageGrid = (docType: DocTypeKey) => {
    const list = selected[docType];
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {list.map((item) => (
          <div key={item.id} className="group relative overflow-hidden rounded-2xl border border-white/10 bg-black/20">
            <button
              type="button"
              onClick={() =>
                setPreview({ name: item.file.name, url: item.url, mimeType: item.file.type || null })
              }
              className="block w-full"
            >
              {isImage(item.file) ? (
                <img src={item.url} alt={item.file.name} className="h-28 w-full object-cover" />
              ) : (
                <div className="flex h-28 w-full items-center justify-center text-xs text-white/60">
                  {item.file.name}
                </div>
              )}
            </button>
            <button
              type="button"
              onClick={() => removeFile(docType, item.id)}
              className="absolute right-2 top-2 rounded-full border border-rose-400/30 bg-rose-500/60 px-2 py-0.5 text-xs text-white opacity-0 transition group-hover:opacity-100"
            >
              {locale === "zh" ? "\u5220\u9664" : "Remove"}
            </button>
          </div>
        ))}
        {renderUploadTile(docType)}
      </div>
    );
  };

  const renderSection = (docType: DocTypeKey, hint: string) => {
    const config = DOC_TYPES[docType];
    return (
      <div className="rounded-3xl border border-white/10 bg-gradient-to-br from-white/10 via-white/5 to-transparent p-5 space-y-4 shadow-[0_18px_50px_-40px_rgba(0,0,0,0.8)]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-white/90 font-semibold">
            <span className="inline-flex h-2 w-2 rounded-full bg-sky-400/80" />
            <span>
              {locale === "zh" ? config.zh : config.en}
              <span className="ml-2 text-xs text-rose-200">*</span>
            </span>
          </div>
          <div className="text-xs text-white/50">{hint}</div>
        </div>
        {docType === "enrollment_form" ? (
          <div className="space-y-3">
            {docType === "enrollment_form" ? (
              <div className="text-xs text-rose-200">
                {locale === "zh"
                  ? "\u5fc5\u987b\u7528\u81ea\u5df1\u7684\u59d3\u540d\u547d\u540d\u6587\u4ef6"
                  : "Use your own name for the file name."}
              </div>
            ) : null}
            {renderUploadTile(docType)}
            {renderDocList(docType)}
          </div>
        ) : (
          renderImageGrid(docType)
        )}
        <div className="text-xs text-white/50">
          {locale === "zh"
            ? `\u5df2\u9009 ${selected[docType].length} \u4e2a\u6587\u4ef6`
            : `${selected[docType].length} file(s) selected`}
        </div>
      </div>
    );
  };

  return (
    <form
      className="space-y-8"
      onSubmit={(e) => {
        e.preventDefault();
        submitAll();
      }}
    >
      <div className="rounded-3xl border border-white/10 bg-gradient-to-br from-white/10 via-white/5 to-transparent p-6 shadow-[0_22px_60px_-45px_rgba(0,0,0,0.85)]">
        <div className="text-white/90 font-semibold text-xl">
          {locale === "zh" ? "\u8d44\u6599\u4e0a\u4f20" : "Document upload"}
        </div>
        <div className="mt-2 text-white/60 text-sm">
          {locale === "zh"
            ? "\u4e09\u9879\u8d44\u6599\u5fc5\u987b\u5168\u90e8\u4e0a\u4f20\uff0c\u4e00\u6b21\u63d0\u4ea4\u3002\u4e0a\u4f20\u5b8c\u6210\u540e\u624d\u80fd\u70b9\u51fb\u63d0\u4ea4\u3002"
            : "All three document types are required and submitted together."}
        </div>
        <div className="mt-4 rounded-2xl border border-sky-300/20 bg-sky-400/10 p-4 text-sm leading-7 text-sky-50/80">
          {locale === "zh"
            ? "请先在「文件」菜单申请并学习：第一阶段、MT4软件操作、绿色免安装、报名表。学习和填写完成后，再按下方提示上传资料；如有疑问，通过「咨询」联系团队长。"
            : "First request and study Stage 1, MT4 software guide, portable package, and enrollment form in Files. Then upload the required documents below. Contact your leader through Consult if needed."}
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href="/system/files" className="rounded-xl border border-white/15 bg-white/10 px-3 py-1.5 text-xs text-white/86 hover:bg-white/15">
              {locale === "zh" ? "去文件申请资料" : "Go to files"}
            </Link>
            <Link href="/system/consult" className="rounded-xl border border-white/15 bg-white/10 px-3 py-1.5 text-xs text-white/86 hover:bg-white/15">
              {locale === "zh" ? "咨询团队长" : "Consult leader"}
            </Link>
          </div>
        </div>
      </div>

      {notice ? (
        <div
          className={[
            "rounded-3xl border p-5 text-sm",
            notice.type === "error"
              ? "border-rose-400/30 bg-rose-500/10 text-rose-100"
              : "border-emerald-400/30 bg-emerald-500/10 text-emerald-100"
          ].join(" ")}
        >
          {notice.message}
        </div>
      ) : null}

      {renderSection("enrollment_form", locale === "zh" ? "\u652f\u6301 doc/docx/pdf" : "Supports doc/docx/pdf")}
      {renderSection(
        "trial_screenshot",
        locale === "zh" ? "\u4e0a\u4f20\u8bd5\u7528\u754c\u9762\u622a\u56fe" : "Upload trial UI screenshot"
      )}
      {renderSection(
        "verification_image",
        locale === "zh" ? "\u6700\u591a\u4e0a\u4f20 3 \u5f20" : "Up to 3 images"
      )}

      <div className="flex items-center justify-end">
        <button
          type="submit"
          disabled={!requiredReady || submitting}
          className="px-6 py-3 rounded-2xl border border-sky-400/40 bg-sky-500/90 text-base font-semibold text-white shadow-[0_16px_36px_-24px_rgba(56,189,248,0.9)] hover:bg-sky-400/90 disabled:opacity-50 disabled:shadow-none"
        >
          {submitting ? (locale === "zh" ? "\u63d0\u4ea4\u4e2d..." : "Submitting...") : locale === "zh" ? "\u63d0\u4ea4" : "Submit"}
        </button>
      </div>

      <PreviewModal
        file={preview ? { name: preview.name, url: preview.url, mimeType: preview.mimeType } : null}
        locale={locale}
        onClose={() => setPreview(null)}
      />
    </form>
  );
}
