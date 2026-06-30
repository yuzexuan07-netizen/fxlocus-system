"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { fetchSystemJson } from "@/lib/system/clientFetch";
import { createClientRequestId } from "@/lib/system/clientRequestId";

type CourseRow = {
  id: number;
  title_en: string;
  title_zh: string;
  sort_order?: number | null;
  content_type: "video" | "doc" | "mixed";
  video_url?: string | null;
  video_variants?: { label: string; url: string; mime_type?: string | null }[] | null;
  doc_url?: string | null;
  content_url?: string | null;
  content_file_name?: string | null;
  content_mime_type?: string | null;
};

type CourseListRow = {
  id: number;
  title_zh?: string | null;
  title_en?: string | null;
  sort_order?: number | null;
};

type AccessRow = {
  id: string;
  course_id: number;
  status: string;
  progress: number;
  last_video_sec: number;
};

type SummaryRow = {
  content_md?: string | null;
  content_html?: string | null;
  submitted_at?: string | null;
  reviewed_at?: string | null;
  review_note?: string | null;
};

export function CoursePlayerClient({
  locale,
  course,
  access,
  courseList,
  initialSummary
}: {
  locale: "zh" | "en";
  course: CourseRow;
  access: AccessRow;
  courseList: CourseListRow[];
  initialSummary: SummaryRow | null;
}) {
  const router = useRouter();
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const editorRef = React.useRef<HTMLDivElement | null>(null);
  const imageInputRef = React.useRef<HTMLInputElement | null>(null);

  const [summaryHtml, setSummaryHtml] = React.useState(initialSummary?.content_html || initialSummary?.content_md || "");
  const [summaryText, setSummaryText] = React.useState(initialSummary?.content_md || "");
  const [submittedAt, setSubmittedAt] = React.useState<string | null>(initialSummary?.submitted_at || null);
  const [reviewedAt, setReviewedAt] = React.useState<string | null>(initialSummary?.reviewed_at || null);
  const [reviewNote, setReviewNote] = React.useState<string | null>(initialSummary?.review_note || null);
  const [savingSummary, setSavingSummary] = React.useState(false);
  const [submittingSummary, setSubmittingSummary] = React.useState(false);
  const [uploadingImage, setUploadingImage] = React.useState(false);
  const [savingProgress, setSavingProgress] = React.useState(false);
  const [accessStatus, setAccessStatus] = React.useState(access.status);
  const [completing, setCompleting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [captureBlocked, setCaptureBlocked] = React.useState(false);
  const [captureReason, setCaptureReason] = React.useState<string | null>(null);

  React.useEffect(() => {
    setAccessStatus(access.status);
  }, [access.status]);

  React.useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (access?.last_video_sec) {
      v.currentTime = Math.max(0, access.last_video_sec);
    }
  }, [access?.last_video_sec]);

  React.useEffect(() => {
    const html = initialSummary?.content_html || initialSummary?.content_md || "";
    setSummaryHtml(html);
    setSummaryText(initialSummary?.content_md || "");
    setSubmittedAt(initialSummary?.submitted_at || null);
    setReviewedAt(initialSummary?.reviewed_at || null);
    setReviewNote(initialSummary?.review_note || null);
    if (editorRef.current && editorRef.current.innerHTML !== html) {
      editorRef.current.innerHTML = html;
    }
  }, [
    initialSummary?.content_html,
    initialSummary?.content_md,
    initialSummary?.submitted_at,
    initialSummary?.reviewed_at,
    initialSummary?.review_note
  ]);

  React.useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    let lastSent = 0;

    const onTimeUpdate = () => {
      const now = Date.now();
      if (now - lastSent < 10_000) return;
      lastSent = now;

      const sec = Math.floor(v.currentTime || 0);
      const duration = v.duration || 0;
      const progress = duration ? Math.min(99, Math.floor((sec / duration) * 100)) : null;

      setSavingProgress(true);
      fetchSystemJson(`/api/system/courses/${course.id}/progress`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lastVideoSec: sec, progress }),
        dedupeKey: `course:${course.id}:progress`,
        dedupeWindowMs: 1000,
        retries: 1,
        retryBaseMs: 220,
        retryMaxMs: 900
      })
        .then(() => null)
        .finally(() => setSavingProgress(false));
    };

    v.addEventListener("timeupdate", onTimeUpdate);
    return () => v.removeEventListener("timeupdate", onTimeUpdate);
  }, [course.id]);

  const videoSrc = React.useMemo(() => {
    if (course.video_url) return course.video_url;
    if (!Array.isArray(course.video_variants)) return null;
    const fallback = course.video_variants.find((item) => item && item.url);
    return fallback?.url || null;
  }, [course.video_url, course.video_variants]);

  const pauseForSecurity = React.useCallback((reason: string) => {
    const v = videoRef.current;
    if (v && !v.paused) v.pause();
    setCaptureBlocked(true);
    setCaptureReason(reason);
  }, []);

  const resumePlayback = React.useCallback(() => {
    setCaptureBlocked(false);
    setCaptureReason(null);
    const v = videoRef.current;
    if (v) void v.play().catch(() => {});
  }, []);

  const checkCaptureDevices = React.useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const suspicious = devices.some((device) =>
        /screen|capture|record|virtual|obs/i.test(String(device.label || ""))
      );
      if (suspicious) {
        pauseForSecurity(locale === "zh" ? "检测到录屏设备，已暂停播放。" : "Screen capture device detected.");
      }
    } catch {
      // ignore device enumeration errors
    }
  }, [locale, pauseForSecurity]);

  React.useEffect(() => {
    if (navigator.mediaDevices?.addEventListener) {
      navigator.mediaDevices.addEventListener("devicechange", checkCaptureDevices);
    }
    void checkCaptureDevices();

    return () => {
      if (navigator.mediaDevices?.removeEventListener) {
        navigator.mediaDevices.removeEventListener("devicechange", checkCaptureDevices);
      }
    };
  }, [checkCaptureDevices]);

  const syncEditorState = React.useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    const html = el.innerHTML || "";
    const text = el.innerText || el.textContent || "";
    setSummaryHtml(html);
    setSummaryText(text);
  }, []);

  const execFormat = React.useCallback(
    (command: string, value?: string) => {
      const el = editorRef.current;
      if (!el) return;
      el.focus();
      try {
        document.execCommand(command, false, value);
      } catch {
        // ignore formatting failures
      }
      syncEditorState();
    },
    [syncEditorState]
  );

  const insertHtml = React.useCallback(
    (html: string) => {
      const el = editorRef.current;
      if (!el) return;
      el.focus();
      try {
        document.execCommand("insertHTML", false, html);
      } catch {
        el.innerHTML += html;
      }
      syncEditorState();
    },
    [syncEditorState]
  );

  const uploadImage = React.useCallback(
    async (file: File) => {
      setError(null);
      setUploadingImage(true);
      try {
        const fd = new FormData();
        fd.set("requestId", createClientRequestId(`course_note_image_${course.id}`));
        fd.set("file", file);
        const result = await fetchSystemJson<{ ok?: boolean; url?: string; error?: string }>(
          `/api/system/courses/${course.id}/notes/images`,
          {
            method: "POST",
            body: fd,
            dedupeKey: `course:${course.id}:notes-image`,
            dedupeWindowMs: 300,
            retries: 1,
            retryBaseMs: 220,
            retryMaxMs: 1000
          }
        );
        const json = (result.body || null) as { ok?: boolean; url?: string; error?: string } | null;
        if (!result.ok || !json?.ok || !json.url) {
          throw new Error(json?.error || result.errorCode || "upload_failed");
        }
        insertHtml(`<img src="${json.url}" alt="summary" />`);
      } catch {
        setError(locale === "zh" ? "图片上传失败" : "Image upload failed");
      } finally {
        setUploadingImage(false);
      }
    },
    [course.id, insertHtml, locale]
  );

  const onImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (imageInputRef.current) imageInputRef.current.value = "";
    if (!file) return;
    void uploadImage(file);
  };

  const saveSummary = async (submit: boolean) => {
    setError(null);

    const el = editorRef.current;
    const nextHtml = el?.innerHTML || summaryHtml;
    const nextText = el?.innerText || el?.textContent || summaryText;
    setSummaryHtml(nextHtml);
    setSummaryText(nextText);

    const trimmedText = nextText.trim();
    const trimmedHtml = nextHtml.trim();
    if (submit && !trimmedText && !trimmedHtml) {
      setError(locale === "zh" ? "请先输入总结/收获" : "Summary is required.");
      return;
    }

    submit ? setSubmittingSummary(true) : setSavingSummary(true);
    try {
      const result = await fetchSystemJson<{ ok?: boolean; error?: string }>(`/api/system/courses/${course.id}/notes`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contentHtml: nextHtml, contentText: nextText, submit }),
        dedupeKey: `course:${course.id}:notes:${submit ? "submit" : "save"}`,
        dedupeWindowMs: 300,
        retries: 1,
        retryBaseMs: 220,
        retryMaxMs: 1000
      });
      const json = (result.body || null) as { ok?: boolean; error?: string } | null;
      if (!result.ok || !json?.ok) {
        setError(locale === "zh" ? "保存失败" : "Save failed");
      } else {
        if (submit) {
          setSubmittedAt(new Date().toISOString());
          setReviewedAt(null);
          setReviewNote(null);
        }
        router.refresh();
      }
    } catch {
      setError(locale === "zh" ? "网络错误" : "Network error");
    } finally {
      submit ? setSubmittingSummary(false) : setSavingSummary(false);
    }
  };

  const complete = async () => {
    if (accessStatus === "completed" || completing) return;
    setError(null);
    setCompleting(true);
    try {
      const result = await fetchSystemJson<{ ok?: boolean; error?: string }>(`/api/system/courses/${course.id}/complete`, {
        method: "POST",
        dedupeKey: `course:${course.id}:complete`,
        dedupeWindowMs: 300,
        retries: 1,
        retryBaseMs: 220,
        retryMaxMs: 900
      });
      const json = (result.body || null) as { ok?: boolean; error?: string } | null;
      if (!result.ok || !json?.ok) {
        setError(locale === "zh" ? "操作失败" : "Failed");
        return;
      }
      setAccessStatus("completed");
      router.refresh();
    } finally {
      setCompleting(false);
    }
  };

  const summaryStatus = reviewedAt
    ? locale === "zh"
      ? "已阅"
      : "Reviewed"
    : submittedAt
      ? locale === "zh"
        ? "已提交，等待审批，请勿重复提交"
        : "Submitted (waiting for review)"
      : null;

  const hasSummary = summaryText.trim().length > 0 || summaryHtml.trim().length > 0;
  const sidebarCourses = React.useMemo(() => {
    const rows = Array.isArray(courseList) && courseList.length ? courseList : [course];
    return rows
      .map((item, index) => ({
        id: Number(item.id || 0),
        sort_order: Number(item.sort_order ?? index + 1),
        title_zh: item.title_zh || `\u7b2c${index + 1}\u8bfe`,
        title_en: item.title_en || `Lesson ${index + 1}`
      }))
      .filter((item) => item.id > 0)
      .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
  }, [course, courseList]);

  return (
    <div className="grid h-full min-h-0 grid-cols-1 gap-4 xl:grid-cols-[260px_minmax(0,1fr)_360px]">
      <aside className="hidden overflow-y-auto rounded-3xl border border-white/10 bg-white/5 p-4 xl:block">
        <div className="font-semibold text-white/85">{locale === "zh" ? "课程目录" : "Course tree"}</div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {sidebarCourses.map((item) => {
            return (
              <a
                key={item.id}
                href={`/${locale}/system/courses/${item.id}`}
                className={`rounded-xl border px-3 py-2 text-sm ${
                  item.id === course.id
                    ? "border-white/20 bg-white/10 text-white"
                    : "border-white/10 bg-white/0 text-white/70 hover:bg-white/5"
                }`}
                title={locale === "zh" ? item.title_zh : item.title_en}
              >
                <span className="block text-xs text-white/45">#{item.sort_order || item.id}</span>
                <span className="block truncate">{locale === "zh" ? item.title_zh : item.title_en}</span>
              </a>
            );
          })}
        </div>
      </aside>

      <main className="flex min-h-0 flex-col overflow-hidden rounded-3xl border border-white/10 bg-white/5">
        <div className="border-b border-white/10 p-4">
          <div className="text-lg font-semibold text-white/90">{locale === "zh" ? course.title_zh : course.title_en}</div>
          <div className="mt-1 flex items-center gap-2 text-xs text-white/50">
            <span>{savingProgress ? (locale === "zh" ? "进度保存中..." : "Saving...") : null}</span>
            <span className="ml-auto">
              <button
                type="button"
                onClick={complete}
                disabled={accessStatus === "completed" || completing}
                className={`rounded-xl border px-3 py-1.5 font-semibold transition ${
                  accessStatus === "completed"
                    ? "border-emerald-300/50 bg-emerald-500/25 text-emerald-100 shadow-[0_0_18px_rgba(16,185,129,0.18)]"
                    : "border-yellow-300/55 bg-yellow-400/20 text-yellow-100 hover:bg-yellow-400/30"
                } disabled:cursor-default`}
              >
                {accessStatus === "completed"
                  ? locale === "zh"
                    ? "已完成"
                    : "Completed"
                  : completing
                    ? locale === "zh"
                      ? "处理中..."
                      : "Processing..."
                    : locale === "zh"
                      ? "标记完成"
                      : "Mark complete"}
              </button>
            </span>
          </div>
        </div>

        <div className="relative flex-1 min-h-0 overflow-hidden">
          {videoSrc ? (
            <video
              ref={videoRef}
              className="h-full w-full"
              controls
              playsInline
              preload="metadata"
              controlsList="nodownload"
              disablePictureInPicture
              onContextMenu={(e) => e.preventDefault()}
              src={videoSrc || undefined}
            />
          ) : course.doc_url ? (
            <>
              <iframe className="h-full w-full" src={course.doc_url || undefined} />
              {course.content_url ? (
                <a
                  href={course.content_url}
                  target="_blank"
                  rel="noreferrer"
                  className="absolute right-4 top-4 rounded-xl border border-white/20 bg-black/45 px-3 py-1.5 text-sm text-white backdrop-blur hover:bg-black/60"
                >
                  {locale === "zh" ? "\u4e0b\u8f7d" : "Download"}
                </a>
              ) : null}
            </>
          ) : course.content_url ? (
            <div className="p-6">
              <div className="font-semibold text-white/80">{locale === "zh" ? "课程内容文件" : "Course content file"}</div>
              <div className="mt-2 break-all text-sm text-white/60">{course.content_file_name || course.content_mime_type || ""}</div>
              <div className="mt-4">
                <a
                  href={course.content_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex rounded-xl border border-white/20 bg-white/10 px-3 py-1.5 text-white hover:bg-white/15"
                >
                  {locale === "zh" ? "打开 / 下载" : "Open / Download"}
                </a>
              </div>
            </div>
          ) : (
            <div className="p-6 text-white/60">{locale === "zh" ? "课程内容未配置。" : "Content not configured."}</div>
          )}

          {captureBlocked ? (
            <div className="absolute inset-0 flex items-center justify-center bg-black/70 p-6">
              <div className="max-w-md text-center">
                <div className="font-semibold text-white/90">{locale === "zh" ? "播放已暂停" : "Playback paused"}</div>
                <div className="mt-2 text-sm text-white/70">
                  {captureReason ||
                    (locale === "zh"
                      ? "检测到疑似录屏行为，已暂停播放。"
                      : "Potential screen recording detected.")}
                </div>
                <button
                  type="button"
                  onClick={resumePlayback}
                  className="mt-4 rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-white hover:bg-white/15"
                >
                  {locale === "zh" ? "继续播放" : "Resume"}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </main>

      <aside className="flex min-h-0 flex-col rounded-3xl border border-white/10 bg-white/5 p-4">
        <div className="font-semibold text-white/85">{locale === "zh" ? "总结 / 收获" : "Summary / Takeaways"}</div>
        <div className="mt-2 text-xs text-white/50">
          {locale === "zh" ? "支持加粗 / 斜体 / 图片上传" : "Bold, italic, and image uploads"}
        </div>

        {summaryStatus ? <div className="mt-3 text-xs text-sky-100/80">{summaryStatus}</div> : null}

        {reviewNote ? (
          <div className="mt-2 rounded-2xl border border-sky-200/10 bg-sky-500/10 px-3 py-2 text-sm text-sky-100">
            {locale === "zh" ? "审批内容" : "Review note"}: {reviewNote}
          </div>
        ) : null}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => execFormat("bold")}
            className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-white/80 hover:bg-white/10"
          >
            B
          </button>
          <button
            type="button"
            onClick={() => execFormat("italic")}
            className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-white/80 hover:bg-white/10"
          >
            I
          </button>
          <button
            type="button"
            disabled={uploadingImage}
            onClick={() => imageInputRef.current?.click()}
            className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-white/80 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {locale === "zh" ? "图片" : "Image"}
          </button>
          <input
            ref={imageInputRef}
            type="file"
            accept="image/png,image/jpeg"
            onChange={onImageChange}
            className="hidden"
          />
        </div>

        <div
          ref={editorRef}
          className="summary-editor mt-3 flex-1 min-h-0 w-full overflow-y-auto rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/85"
          contentEditable
          onInput={syncEditorState}
          data-placeholder={locale === "zh" ? "记录你的总结 / 收获..." : "Write your summary..."}
          suppressContentEditableWarning
        />

        {error ? (
          <div className="mt-3 rounded-2xl border border-rose-400/20 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">{error}</div>
        ) : null}

        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            disabled={savingSummary || submittingSummary}
            onClick={() => saveSummary(false)}
            className="rounded-xl border border-white/20 bg-white/10 px-3 py-1.5 text-white hover:bg-white/15 disabled:opacity-50"
          >
            {locale === "zh" ? "保存" : "Save"}
          </button>
          <button
            type="button"
            disabled={!hasSummary || savingSummary || submittingSummary}
            onClick={() => saveSummary(true)}
            className="ml-auto rounded-xl border border-white/30 bg-white/15 px-3 py-1.5 text-white hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submittingSummary
              ? locale === "zh"
                ? "提交中..."
                : "Submitting..."
              : locale === "zh"
                ? "提交"
                : "Submit"}
          </button>
        </div>
      </aside>
    </div>
  );
}
