"use client";

import React from "react";
import { FileText, FileVideo, UploadCloud } from "lucide-react";

import { ClientDateTime } from "@/components/system/ClientDateTime";
import { createClientRequestId } from "@/lib/system/clientRequestId";
import { fetchSystemJson } from "@/lib/system/clientFetch";
import {
  COURSE_TYPE_ADVANCED,
  COURSE_TYPES,
  getCourseTypeLabel,
  normalizeCourseType,
  type CourseType
} from "@/lib/system/courseTypes";

function ContentIcon({ mimeType }: { mimeType: string | null | undefined }) {
  const mime = String(mimeType || "").toLowerCase();
  if (mime.startsWith("video/") || mime.includes("mp4")) return <FileVideo className="h-4 w-4 text-white/70" />;
  if (mime.includes("pdf") || mime.includes("msword") || mime.includes("officedocument")) {
    return <FileText className="h-4 w-4 text-white/70" />;
  }
  return <FileText className="h-4 w-4 text-white/70" />;
}

type CourseRow = {
  id: number;
  course_type?: string | null;
  sort_order?: number | null;
  title_zh?: string | null;
  title_en?: string | null;
  summary_zh?: string | null;
  summary_en?: string | null;
  published?: boolean | null;
  deleted_at?: string | null;
  content_bucket?: string | null;
  content_path?: string | null;
  content_file_name?: string | null;
  content_mime_type?: string | null;
  video_variants?: any[] | null;
};

const MAX_CONTENT_BYTES = 1024 * 1024 * 1024;

export function AdminCourseContentClient({
  locale,
  initialCourses
}: {
  locale: "zh" | "en";
  initialCourses: CourseRow[];
}) {
  const buildPlaceholderCourse = React.useCallback(
    (id: number, courseType: CourseType = COURSE_TYPE_ADVANCED, sortOrder?: number): CourseRow => {
      const displayOrder = Number(sortOrder || id);
      return {
        id,
        course_type: courseType,
        sort_order: displayOrder,
        title_zh:
          courseType === COURSE_TYPE_ADVANCED
            ? `\u7b2c${displayOrder}\u8bfe`
            : `${getCourseTypeLabel(courseType, "zh")} #${displayOrder}`,
        title_en:
          courseType === COURSE_TYPE_ADVANCED
            ? `Lesson ${displayOrder}`
            : `${getCourseTypeLabel(courseType, "en")} #${displayOrder}`,
        summary_zh: "课程内容准备中。",
        summary_en: "Content coming soon.",
        published: false
      };
    },
    []
  );

  const normalizeCourses = React.useCallback(
    (items: CourseRow[]) => {
      const map = new Map<number, CourseRow>();
      (items || []).forEach((course) => {
        if (!course) return;
        const id = Number(course.id);
        if (!Number.isFinite(id) || id < 1) return;
        const courseType = normalizeCourseType(course.course_type);
        map.set(id, { ...buildPlaceholderCourse(id, courseType, Number(course.sort_order || id)), ...course, id, course_type: courseType });
      });

      return Array.from(map.values())
        .sort(
          (a, b) =>
            COURSE_TYPES.indexOf(normalizeCourseType(a.course_type)) -
              COURSE_TYPES.indexOf(normalizeCourseType(b.course_type)) ||
            Number(a.sort_order ?? a.id) - Number(b.sort_order ?? b.id) ||
            a.id - b.id
        );
    },
    [buildPlaceholderCourse]
  );

  const [courses, setCourses] = React.useState<CourseRow[]>(() => normalizeCourses(initialCourses));
  const [busy, setBusy] = React.useState<Record<number, boolean>>({});
  const [activeType, setActiveType] = React.useState<CourseType>(COURSE_TYPE_ADVANCED);
  const [error, setError] = React.useState<string | null>(null);
  const [metaSaved, setMetaSaved] = React.useState<Record<number, boolean>>({});
  const [metaNotice, setMetaNotice] = React.useState<Record<number, { type: "success" | "error"; message: string }>>({});
  const [fileById, setFileById] = React.useState<Record<number, File | null>>({});
  const inputRefs = React.useRef<Record<number, HTMLInputElement | null>>({});

  const sortCourses = React.useCallback((items: CourseRow[]) => {
    return [...items].sort(
      (a, b) =>
        COURSE_TYPES.indexOf(normalizeCourseType(a.course_type)) -
          COURSE_TYPES.indexOf(normalizeCourseType(b.course_type)) ||
        Number(a.sort_order ?? a.id) - Number(b.sort_order ?? b.id) ||
        a.id - b.id
    );
  }, []);

  React.useEffect(() => {
    const nextCourses = normalizeCourses(initialCourses);
    setCourses(nextCourses);
    setMetaSaved({});
    setMetaNotice({});
  }, [initialCourses, normalizeCourses]);

  const updateLocal = (course: CourseRow) => {
    setCourses((prev) => {
      const map = new Map(prev.map((c) => [c.id, c]));
      const courseType = normalizeCourseType(course.course_type);
      map.set(course.id, { ...map.get(course.id), ...course, course_type: courseType });
      return sortCourses(Array.from(map.values()));
    });
  };

  const ensureCourse = React.useCallback(
    (courseId: number, courseType: CourseType = COURSE_TYPE_ADVANCED, sortOrder?: number) => {
      setCourses((prev) => {
        if (prev.some((c) => c.id === courseId)) return prev;
        return sortCourses([...prev, buildPlaceholderCourse(courseId, courseType, sortOrder)]);
      });
    },
    [buildPlaceholderCourse, sortCourses]
  );

  const ensureNextCourseAfter = React.useCallback(
    (course: Pick<CourseRow, "id" | "course_type" | "sort_order">) => {
      const courseType = normalizeCourseType(course.course_type);
      const nextSortOrder = Number(course.sort_order ?? course.id) + 1;
      setCourses((prev) => {
        if (
          prev.some(
            (item) =>
              normalizeCourseType(item.course_type) === courseType &&
              Number(item.sort_order ?? item.id) === nextSortOrder
          )
        ) {
          return prev;
        }
        const nextId = Math.max(0, ...prev.map((item) => Number(item.id || 0))) + 1;
        return sortCourses([...prev, buildPlaceholderCourse(nextId, courseType, nextSortOrder)]);
      });
    },
    [buildPlaceholderCourse, sortCourses]
  );

  const markDirty = React.useCallback((courseId: number) => {
    setMetaSaved((prev) => ({ ...prev, [courseId]: false }));
    setMetaNotice((prev) => {
      const next = { ...prev };
      delete next[courseId];
      return next;
    });
  }, []);

  const saveMeta = async (course: CourseRow) => {
    setBusy((p) => ({ ...p, [course.id]: true }));
    setError(null);
    try {
      const result = await fetchSystemJson<{ ok?: boolean; course?: CourseRow }>("/api/system/admin/courses/update-meta", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          courseId: course.id,
          courseType: normalizeCourseType(course.course_type),
          sortOrder: Number(course.sort_order ?? course.id),
          title_zh: course.title_zh ?? "",
          title_en: course.title_en ?? "",
          summary_zh: course.summary_zh ?? "",
          summary_en: course.summary_en ?? "",
          published: Boolean(course.published)
        }),
        dedupeKey: `admin-course-content:meta:${course.id}`,
        dedupeWindowMs: 260,
        retries: 1,
        retryBaseMs: 220,
        retryMaxMs: 1200
      });
      const json = (result.body || null) as any;
      if (!result.ok || !json?.ok) throw new Error(json?.error || result.errorCode || "save_failed");
      if (json.course) updateLocal(json.course);
      setMetaSaved((prev) => ({ ...prev, [course.id]: true }));
      setMetaNotice((prev) => ({
        ...prev,
        [course.id]: {
          type: "success",
          message: locale === "zh" ? "保存成功" : "Saved"
        }
      }));
    } catch (e: any) {
      setError(e?.message || "save_failed");
      setMetaSaved((prev) => ({ ...prev, [course.id]: false }));
      setMetaNotice((prev) => ({
        ...prev,
        [course.id]: {
          type: "error",
          message: locale === "zh" ? "保存失败" : "Save failed"
        }
      }));
    } finally {
      setBusy((p) => ({ ...p, [course.id]: false }));
    }
  };

  const upload = async (course: CourseRow) => {
    const file = fileById[course.id] || null;
    if (!file) return;
    if (file.size > MAX_CONTENT_BYTES) {
      setError(locale === "zh" ? "文件大小不能超过 1GB" : "File must be <= 1GB");
      return;
    }
    setBusy((p) => ({ ...p, [course.id]: true }));
    setError(null);
    try {
      const fd = new FormData();
      fd.set("requestId", createClientRequestId(`course_content_${course.id}`));
      fd.set("courseId", String(course.id));
      fd.set("courseType", normalizeCourseType(course.course_type));
      fd.set("sortOrder", String(Number(course.sort_order ?? course.id)));
      fd.set("file", file);
      fd.set("title_zh", course.title_zh ?? "");
      fd.set("title_en", course.title_en ?? "");
      fd.set("summary_zh", course.summary_zh ?? "");
      fd.set("summary_en", course.summary_en ?? "");
      fd.set("published", String(Boolean(course.published)));
      const result = await fetchSystemJson<{ ok?: boolean; course?: CourseRow }>("/api/system/admin/courses/upload-content", {
        method: "POST",
        body: fd,
        dedupeKey: `admin-course-content:upload:${course.id}`,
        dedupeWindowMs: 260,
        retries: 1,
        retryBaseMs: 220,
        retryMaxMs: 1200
      });
      const json = (result.body || null) as any;
      if (!result.ok || !json?.ok) throw new Error(json?.error || result.errorCode || "upload_failed");
      if (json.course) {
        updateLocal(json.course);
        ensureNextCourseAfter(json.course);
      } else {
        ensureNextCourseAfter(course);
      }
      setFileById((p) => ({ ...p, [course.id]: null }));
      const input = inputRefs.current[course.id];
      if (input) input.value = "";
    } catch (e: any) {
      setError(e?.message || "upload_failed");
    } finally {
      setBusy((p) => ({ ...p, [course.id]: false }));
    }
  };

  const toggleDeleted = async (course: CourseRow, deleted: boolean) => {
    setBusy((p) => ({ ...p, [course.id]: true }));
    setError(null);
    try {
      const result = await fetchSystemJson<{ ok?: boolean; course?: CourseRow }>("/api/system/admin/courses/update-meta", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          courseId: course.id,
          courseType: normalizeCourseType(course.course_type),
          sortOrder: Number(course.sort_order ?? course.id),
          deleted
        }),
        dedupeKey: `admin-course-content:deleted:${course.id}:${deleted ? "1" : "0"}`,
        dedupeWindowMs: 260,
        retries: 1,
        retryBaseMs: 220,
        retryMaxMs: 1200
      });
      const json = (result.body || null) as any;
      if (!result.ok || !json?.ok) throw new Error(json?.error || result.errorCode || "update_failed");
      if (json.course) updateLocal(json.course);
    } catch (e: any) {
      setError(e?.message || "update_failed");
    } finally {
      setBusy((p) => ({ ...p, [course.id]: false }));
    }
  };

  const visibleCourses = React.useMemo(() => {
    return courses
      .filter((course) => {
        const courseType = normalizeCourseType(course.course_type);
        return courseType === activeType;
      })
      .sort((a, b) => Number(a.sort_order ?? a.id) - Number(b.sort_order ?? b.id) || a.id - b.id);
  }, [activeType, courses]);

  const addCourse = React.useCallback(() => {
    const nextId = Math.max(0, ...courses.map((course) => Number(course.id || 0))) + 1;
    const sortOrder =
      Math.max(
        0,
        ...courses
          .filter((course) => normalizeCourseType(course.course_type) === activeType)
          .map((course) => Number(course.sort_order ?? 0))
      ) + 1;
    ensureCourse(nextId, activeType, sortOrder);
  }, [activeType, courses, ensureCourse]);

  const addButtonLabel = locale === "zh" ? "扩展下一课" : "Add next lesson";

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
        <div className="text-white/90 font-semibold text-xl">{locale === "zh" ? "课程内容管理" : "Course content"}</div>
        <div className="mt-2 text-white/60 text-sm">
          {locale === "zh"
            ? "上传课程内容文件，并设置标题、上下架、软删除。"
            : "Upload course content files and manage title/publish/delete."}
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          {COURSE_TYPES.map((type) => {
            const active = activeType === type;
            return (
              <button
                key={type}
                type="button"
                onClick={() => setActiveType(type)}
                className={[
                  "rounded-2xl border px-4 py-2 text-sm transition",
                  active
                    ? "border-cyan-300/40 bg-cyan-400/15 text-cyan-50"
                    : "border-white/10 bg-white/5 text-white/70 hover:bg-white/10"
                ].join(" ")}
              >
                {getCourseTypeLabel(type, locale)}
              </button>
            );
          })}
        </div>
      </div>

      {error ? (
        <div className="rounded-3xl border border-rose-400/20 bg-rose-500/10 p-6 text-rose-100">{error}</div>
      ) : null}

      <div className="space-y-4">
        <div className="flex justify-end">
          <button
            type="button"
            onClick={addCourse}
            className="px-4 py-2 rounded-xl bg-white/10 border border-white/20 text-white hover:bg-white/15"
          >
            {addButtonLabel}
          </button>
        </div>

        {visibleCourses.map((c) => {
          const isBusy = Boolean(busy[c.id]);
          const deleted = Boolean(c.deleted_at);
          const hasContent = Boolean(c.content_path) || Boolean(c.video_variants?.length);
          const saved = Boolean(metaSaved[c.id]);
          const notice = metaNotice[c.id];
          const courseType = normalizeCourseType(c.course_type);
          const courseLabel =
            courseType === COURSE_TYPE_ADVANCED
              ? locale === "zh"
                ? `\u7b2c${c.sort_order || c.id}\u8bfe`
                : `Lesson ${c.sort_order || c.id}`
              : `${getCourseTypeLabel(courseType, locale)} #${c.sort_order || c.id}`;

          return (
            <div key={c.id} className="rounded-3xl border border-white/10 bg-white/5 p-6 space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <div className="text-white/90 font-semibold">{courseLabel}</div>
                {deleted ? (
                  <span className="text-xs rounded-full border border-rose-400/30 bg-rose-500/10 px-2 py-1 text-rose-100">
                    {locale === "zh" ? "已删除" : "Deleted"}
                  </span>
                ) : null}
                <label className="ml-auto flex items-center gap-2 text-sm text-white/70">
                  <input
                    type="checkbox"
                    checked={Boolean(c.published) && !deleted}
                    disabled={deleted}
                    onChange={(e) =>
                      setCourses((prev) => {
                        markDirty(c.id);
                        return prev.map((x) => (x.id === c.id ? { ...x, published: e.target.checked } : x));
                      })
                    }
                  />
                  {locale === "zh" ? "已发布" : "Published"}
                </label>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <input
                  value={c.title_zh || ""}
                  onChange={(e) =>
                    setCourses((prev) => {
                      markDirty(c.id);
                      return prev.map((x) => (x.id === c.id ? { ...x, title_zh: e.target.value } : x));
                    })
                  }
                  className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-white/85 text-sm"
                  placeholder={locale === "zh" ? "中文标题" : "Title (ZH)"}
                />
                <input
                  value={c.title_en || ""}
                  onChange={(e) =>
                    setCourses((prev) => {
                      markDirty(c.id);
                      return prev.map((x) => (x.id === c.id ? { ...x, title_en: e.target.value } : x));
                    })
                  }
                  className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-white/85 text-sm"
                  placeholder={locale === "zh" ? "英文标题" : "Title (EN)"}
                />
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <textarea
                  value={c.summary_zh || ""}
                  onChange={(e) =>
                    setCourses((prev) => {
                      markDirty(c.id);
                      return prev.map((x) => (x.id === c.id ? { ...x, summary_zh: e.target.value } : x));
                    })
                  }
                  className="min-h-[88px] rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-white/85 text-sm"
                  placeholder={locale === "zh" ? "中文描述" : "Summary (ZH)"}
                />
                <textarea
                  value={c.summary_en || ""}
                  onChange={(e) =>
                    setCourses((prev) => {
                      markDirty(c.id);
                      return prev.map((x) => (x.id === c.id ? { ...x, summary_en: e.target.value } : x));
                    })
                  }
                  className="min-h-[88px] rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-white/85 text-sm"
                  placeholder={locale === "zh" ? "英文描述" : "Summary (EN)"}
                />
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="text-xs text-white/50">{locale === "zh" ? "内容" : "Content"}</div>
                  <div className="mt-2 flex items-center gap-2 text-sm text-white/80 min-w-0">
                    {c.content_path ? (
                      <ContentIcon mimeType={c.content_mime_type} />
                    ) : (
                      <UploadCloud className="h-4 w-4 text-white/70" />
                    )}
                    <span className="min-w-0 truncate">
                      {c.content_file_name || c.content_path || (locale === "zh" ? "未上传" : "Not uploaded")}
                    </span>
                  </div>
                  {c.content_path ? (
                    <div className="mt-2 text-xs text-white/45 break-all">
                      {c.content_bucket}/{c.content_path}
                    </div>
                  ) : null}
                </div>

                <div className="md:col-span-2 rounded-2xl border border-white/10 bg-white/5 p-4 space-y-3">
                  <div className="text-xs text-white/50">{locale === "zh" ? "上传/替换内容" : "Upload/replace"}</div>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="file"
                      disabled={isBusy}
                      onChange={(e) => {
                        const next = e.target.files?.[0] || null;
                        if (!next) {
                          setFileById((p) => ({ ...p, [c.id]: null }));
                          return;
                        }
                        if (next.size > MAX_CONTENT_BYTES) {
                          setError(locale === "zh" ? "文件大小不能超过 1GB" : "File must be <= 1GB");
                          e.currentTarget.value = "";
                          return;
                        }
                        setFileById((p) => ({ ...p, [c.id]: next }));
                      }}
                      ref={(el) => {
                        inputRefs.current[c.id] = el;
                      }}
                      className="hidden"
                      accept=".pdf,.doc,.docx,.mp4,application/pdf,video/mp4,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    />

                    <div className="space-y-2">
                      <button
                        type="button"
                        disabled={isBusy}
                        data-disabled={isBusy ? "1" : "0"}
                        onClick={() => inputRefs.current[c.id]?.click()}
                        className="system-upload-card h-[140px] w-full sm:w-[260px]"
                        title={locale === "zh" ? "仅允许 doc/docx/pdf/mp4，单文件 <= 1GB" : "doc/docx/pdf/mp4, <= 1GB"}
                      >
                        {fileById[c.id] ? (
                          <div className="system-upload-placeholder">
                            <ContentIcon mimeType={fileById[c.id]?.type} />
                            <div className="text-sm text-white/80">{fileById[c.id]?.name}</div>
                          </div>
                        ) : (
                          <div className="system-upload-placeholder">
                            <div className="system-upload-plus">+</div>
                            <div>{locale === "zh" ? "点击上传文件" : "Upload file"}</div>
                          </div>
                        )}
                      </button>
                      <div className="system-upload-hint">
                        {locale === "zh" ? "支持 doc/docx/pdf/mp4，单文件 <= 1GB" : "doc/docx/pdf/mp4, <= 1GB"}
                      </div>
                    </div>

                    <button
                      type="button"
                      disabled={isBusy || !fileById[c.id]}
                      onClick={() => upload(c)}
                      className="px-3 py-2 rounded-xl bg-white/10 border border-white/20 text-white hover:bg-white/15 disabled:opacity-50"
                    >
                      {hasContent ? (locale === "zh" ? "替换" : "Replace") : locale === "zh" ? "上传" : "Upload"}
                    </button>

                    <button
                      type="button"
                      disabled={isBusy || saved}
                      onClick={() => saveMeta(c)}
                      className="ml-auto px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white/80 hover:bg-white/10 disabled:opacity-50"
                    >
                      {locale === "zh" ? "保存设置" : "Save"}
                    </button>
                  </div>

                  {notice ? (
                    <div className={["text-xs", notice.type === "success" ? "text-emerald-200/80" : "text-rose-200/80"].join(" ")}>
                      {notice.message}
                    </div>
                  ) : null}

                  <div className="flex flex-wrap items-center gap-2">
                    {deleted ? (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => toggleDeleted(c, false)}
                        className="px-3 py-1.5 rounded-xl bg-white/5 border border-white/10 text-white/80 hover:bg-white/10 disabled:opacity-50"
                      >
                        {locale === "zh" ? "恢复" : "Restore"}
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => toggleDeleted(c, true)}
                        className="px-3 py-1.5 rounded-xl bg-rose-500/10 border border-rose-400/20 text-rose-100 hover:bg-rose-500/15 disabled:opacity-50"
                      >
                        {locale === "zh" ? "软删除" : "Soft delete"}
                      </button>
                    )}
                    <div className="ml-auto text-xs text-white/45">
                      {c.deleted_at ? (
                        <span>
                          {locale === "zh" ? "删除时间" : "Deleted at"}: <ClientDateTime value={c.deleted_at} />
                        </span>
                      ) : (
                        ""
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
        {!visibleCourses.length ? (
          <div className="rounded-3xl border border-white/10 bg-white/5 p-6 text-white/60">
            {locale === "zh" ? "\u6682\u65e0\u8bfe\u7a0b\uff0c\u53ef\u70b9\u51fb\u4e0b\u65b9\u6309\u94ae\u65b0\u589e\u3002" : "No courses yet. Use the button below to add one."}
          </div>
        ) : null}
      </div>

      <div className="flex justify-center">
        <button
          type="button"
          onClick={addCourse}
          className="px-4 py-2 rounded-xl bg-white/10 border border-white/20 text-white hover:bg-white/15"
        >
          {addButtonLabel}
        </button>
      </div>
    </div>
  );
}
