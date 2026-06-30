"use client";

import React from "react";
import { useRouter } from "next/navigation";

import { StatusBadge } from "@/components/system/StatusBadge";
import { PaginationControls } from "@/components/ui/PaginationControls";
import { usePagination } from "@/components/ui/usePagination";
import { fetchSystemJson } from "@/lib/system/clientFetch";
import { getCourseRequestBlockMessage, resolveCourseRequestBlockCode } from "@/lib/system/courseAccessRules";
import { getCourseDisplayTitle } from "@/lib/system/courseDisplay";
import {
  COURSE_TYPE_ADVANCED,
  COURSE_TYPE_COGNITIVE,
  COURSE_TYPES,
  getCourseTypeDescription,
  getCourseTypeLabel,
  isBundleCourseType,
  normalizeCourseType,
  type CourseType
} from "@/lib/system/courseTypes";
import { useSystemRealtimeRefresh } from "@/lib/system/useSystemRealtimeRefresh";

type CourseRow = {
  id: number;
  title_en: string;
  title_zh: string;
  summary_en?: string | null;
  summary_zh?: string | null;
  course_type?: string | null;
  sort_order?: number | null;
  content_file_name?: string | null;
  content_path?: string | null;
};

type AccessRow = {
  course_id: number;
  status: "requested" | "approved" | "rejected" | "completed";
  rejection_reason?: string | null;
  progress?: number | null;
};

type NoteRow = {
  course_id: number;
  submitted_at?: string | null;
};

type GroupAccessRow = {
  course_type: string;
  status: "approved" | "rejected";
  rejection_reason?: string | null;
};

export function CoursesClient({
  locale,
  courses,
  access,
  notes,
  groupAccess,
  profileSubmitted
}: {
  locale: "zh" | "en";
  courses: CourseRow[];
  access: AccessRow[];
  notes: NoteRow[];
  groupAccess: GroupAccessRow[];
  profileSubmitted: boolean;
}) {
  const router = useRouter();
  const [loadingId, setLoadingId] = React.useState<number | null>(null);
  const [accessItems, setAccessItems] = React.useState<AccessRow[]>(access);
  const [groupAccessItems, setGroupAccessItems] = React.useState<GroupAccessRow[]>(groupAccess);
  const [userId, setUserId] = React.useState<string | null>(null);
  const [activeType, setActiveType] = React.useState<CourseType>(COURSE_TYPE_COGNITIVE);

  const accessById = React.useMemo(() => new Map(accessItems.map((item) => [item.course_id, item])), [accessItems]);
  const groupAccessByType = React.useMemo(() => {
    const map = new Map<CourseType, GroupAccessRow>();
    (groupAccessItems || []).forEach((item) => {
      const type = normalizeCourseType(item.course_type);
      if (isBundleCourseType(type)) map.set(type, item);
    });
    return map;
  }, [groupAccessItems]);
  const submittedByCourseId = React.useMemo(() => {
    const set = new Set<number>();
    notes.forEach((note) => {
      if (note?.submitted_at) set.add(Number(note.course_id));
    });
    return set;
  }, [notes]);
  const activeCourses = React.useMemo(
    () =>
      courses
        .filter((course) => normalizeCourseType(course.course_type) === activeType)
        .sort((a, b) => Number(a.sort_order ?? a.id) - Number(b.sort_order ?? b.id) || a.id - b.id),
    [activeType, courses]
  );
  const activeIsBundle = isBundleCourseType(activeType);
  const activeGroupAccess = activeIsBundle ? groupAccessByType.get(activeType) || null : null;
  const activeGroupApproved = !activeIsBundle || activeGroupAccess?.status === "approved";
  const { pageItems, page, pageSize, setPage, setPageSize, pageCount, total } = usePagination(activeCourses);
  const cognitiveCompleted = React.useMemo(() => {
    const cognitiveCourses = courses.filter((course) => normalizeCourseType(course.course_type) === COURSE_TYPE_COGNITIVE);
    if (!cognitiveCourses.length) return false;
    return cognitiveCourses.every((course) => accessById.get(course.id)?.status === "completed");
  }, [accessById, courses]);

  React.useEffect(() => {
    setAccessItems(access);
  }, [access]);

  React.useEffect(() => {
    setGroupAccessItems(groupAccess);
  }, [groupAccess]);

  React.useEffect(() => {
    setPage(1);
  }, [activeType, setPage]);

  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const result = await fetchSystemJson<{ ok?: boolean; user?: { id?: string } }>("/api/system/me", {
          dedupeKey: "courses:me",
          retries: 1,
          dedupeWindowMs: 3000
        });
        const json = (result.body || null) as any;
        if (!alive) return;
        if (result.ok && json?.ok) setUserId(String(json.user?.id || ""));
      } catch {
        // ignore
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const loadAccess = React.useCallback(async () => {
    if (!userId) return;
    const result = await fetchSystemJson<{ ok?: boolean; items?: AccessRow[]; groupAccess?: GroupAccessRow[] }>(
      "/api/system/courses/access",
      {
      dedupeKey: "courses:access",
      retries: 2,
      retryBaseMs: 260,
      retryMaxMs: 1400
      }
    );
    const json = (result.body || null) as any;
    if (result.ok && json?.ok && Array.isArray(json.items)) {
      setAccessItems(json.items as AccessRow[]);
    }
    if (result.ok && json?.ok && Array.isArray(json.groupAccess)) {
      setGroupAccessItems(json.groupAccess as GroupAccessRow[]);
    }
  }, [userId]);

  React.useEffect(() => {
    void loadAccess();
  }, [loadAccess]);

  useSystemRealtimeRefresh(loadAccess, {
    tables: ["course_access", "course_group_access"],
    throttleMs: 2500,
    globalThrottleMs: 3000,
    dedupeKey: "courses:access"
  });

  const request = async (courseId: number) => {
    const ok = window.confirm(
      locale === "zh" ? "\u786e\u8ba4\u7533\u8bf7\u8fd9\u95e8\u8bfe\u7a0b\u5417\uff1f" : "Request access to this course?"
    );
    if (!ok) return;
    setLoadingId(courseId);
    try {
      const result = await fetchSystemJson<{ ok?: boolean }>("/api/system/courses/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ courseId }),
        dedupeKey: `courses:request:${courseId}`,
        retries: 1,
        retryBaseMs: 300,
        retryMaxMs: 1000,
        dedupeWindowMs: 500
      });
      const json = (result.body || null) as any;
      if (!result.ok || !json?.ok) return;
      if (userId) {
        await loadAccess();
      }
      router.refresh();
    } finally {
      setLoadingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
        <div className="text-white/90 font-semibold text-xl">{locale === "zh" ? "\u8bfe\u7a0b" : "Courses"}</div>
        <div className="mt-2 text-white/60 text-sm">
          {activeType === COURSE_TYPE_COGNITIVE || activeType === COURSE_TYPE_ADVANCED
            ? locale === "zh"
              ? profileSubmitted
                ? activeType === COURSE_TYPE_ADVANCED
                  ? "\u9700\u5148\u5b8c\u6210\u8ba4\u77e5\u8bfe\u7a0b\uff0c\u518d\u6309\u987a\u5e8f\u7533\u8bf7\u4ea4\u6613\u8bfe\u7a0b\u3002"
                  : "\u8bf7\u6309\u5b8c\u6210\u4e0a\u4e00\u8bfe + \u63d0\u4ea4\u6536\u83b7\u7684\u987a\u5e8f\u9010\u8bfe\u7533\u8bf7\u3002"
                : "\u8bf7\u5148\u4e0a\u4f20\u5e76\u63d0\u4ea4\u4e2a\u4eba\u8d44\u6599\u3002"
              : profileSubmitted
                ? activeType === COURSE_TYPE_ADVANCED
                  ? "Complete cognitive courses before requesting trading courses."
                  : "Unlock lessons one by one after finishing the previous lesson and submitting your takeaways."
                : "Upload and submit your profile documents first."
            : getCourseTypeDescription(activeType, locale)}
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

      {activeIsBundle && !activeGroupApproved ? (
        <div className="rounded-3xl border border-amber-300/20 bg-amber-400/10 p-6">
          <div className="text-white/90 font-semibold">{getCourseTypeLabel(activeType, locale)}</div>
          <div className="mt-2 text-sm text-amber-100/80">
            {locale === "zh"
              ? "\u8be5\u5206\u7c7b\u9700\u8981\u56e2\u961f\u957f\u6216\u8d85\u7ba1\u4e00\u6b21\u6027\u6388\u6743\u540e\u624d\u80fd\u67e5\u770b\u5177\u4f53\u8bfe\u7a0b\u3002"
              : "This category requires one bundle approval from your leader or admin."}
          </div>
          {activeGroupAccess?.status === "rejected" && activeGroupAccess.rejection_reason ? (
            <div className="mt-3 text-xs text-rose-200/90">
              {locale === "zh" ? "\u5173\u95ed\u539f\u56e0\uff1a" : "Reason: "}
              {activeGroupAccess.rejection_reason}
            </div>
          ) : null}
        </div>
      ) : activeCourses.length ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {pageItems.map((course) => {
            const accessItem = accessById.get(course.id);
            const courseType = normalizeCourseType(course.course_type);
            const isBundle = isBundleCourseType(courseType);
            const isIndividual = !isBundle;
            const status = isIndividual ? accessItem?.status || "none" : activeGroupAccess?.status || "approved";
            const canEnter = status === "approved" || status === "completed";
            const displayTitle = getCourseDisplayTitle(locale, course);
            const displayCode = isIndividual
              ? `${getCourseTypeLabel(courseType, locale)} #${course.sort_order || course.id}`
              : `${getCourseTypeLabel(courseType, locale)} #${course.sort_order || course.id}`;
            const currentIndex = activeCourses.findIndex((item) => item.id === course.id);
            const previousCourse = currentIndex > 0 ? activeCourses[currentIndex - 1] : null;
            const requestBlockCode =
              isIndividual && (status === "none" || status === "rejected")
                ? resolveCourseRequestBlockCode({
                    courseId: course.id,
                    courseType,
                    profileSubmitted,
                    cognitiveCompleted,
                    previousCourseCompleted:
                      previousCourse ? accessById.get(previousCourse.id)?.status === "completed" : true,
                    previousSummarySubmitted: previousCourse ? submittedByCourseId.has(previousCourse.id) : true
                  })
                : null;
            const requestBlockMessage = getCourseRequestBlockMessage(requestBlockCode, locale);
            const requestDisabled = loadingId === course.id || Boolean(requestBlockCode);

            return (
              <div key={course.id} className="rounded-3xl border border-white/10 bg-white/5 p-6">
                <div className="flex items-center gap-2">
                  <div className="text-xs text-white/50">{displayCode}</div>
                  <div className="ml-auto">
                    {status === "none" ? (
                      <span className="text-xs text-white/50">
                        {locale === "zh" ? "\u672a\u7533\u8bf7" : "Not requested"}
                      </span>
                    ) : (
                      <StatusBadge value={status} locale={locale} />
                    )}
                  </div>
                </div>

                <div className="mt-2 text-white text-lg font-semibold">{displayTitle}</div>
                <div className="mt-2 text-sm text-white/65 leading-6 line-clamp-3">
                  {locale === "zh" ? course.summary_zh : course.summary_en}
                </div>
                <div className="mt-3 text-xs text-white/55">
                  {course.content_path || course.content_file_name
                    ? locale === "zh"
                      ? `\u5df2\u4e0a\u4f20\u8d44\u6599\uff1a${course.content_file_name || course.content_path}`
                      : `Content: ${course.content_file_name || course.content_path}`
                    : locale === "zh"
                      ? "\u672a\u4e0a\u4f20\u8d44\u6599"
                      : "No content uploaded"}
                </div>

                {isIndividual && accessItem?.status === "rejected" && accessItem.rejection_reason ? (
                  <div className="mt-3 text-xs text-rose-200/90">
                    {locale === "zh" ? "\u62d2\u7edd\u539f\u56e0\uff1a" : "Reason: "} {accessItem.rejection_reason}
                  </div>
                ) : null}

                <div className="mt-4 flex items-center gap-2">
                  {canEnter ? (
                    <a
                      href={`/${locale}/system/courses/${course.id}`}
                      className="px-3 py-1.5 rounded-xl bg-white/10 border border-white/20 text-white hover:bg-white/15"
                    >
                      {locale === "zh" ? "\u8fdb\u5165\u5b66\u4e60" : "Open"}
                    </a>
                  ) : null}

                  {isIndividual && (status === "none" || status === "rejected") ? (
                    <button
                      type="button"
                      disabled={requestDisabled}
                      onClick={() => (requestDisabled ? null : request(course.id))}
                      className="px-3 py-1.5 rounded-xl bg-white/5 border border-white/10 text-white/80 hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {locale === "zh" ? "\u7533\u8bf7\u5b66\u4e60" : "Request access"}
                    </button>
                  ) : null}

                  {status === "requested" ? (
                    <div className="text-xs text-white/50">
                      {locale === "zh" ? "\u7b49\u5f85\u5ba1\u6279\u2026" : "Waiting..."}
                    </div>
                  ) : null}

                  {requestBlockMessage ? <div className="text-xs text-amber-200/80">{requestBlockMessage}</div> : null}

                  {typeof accessItem?.progress === "number" ? (
                    <div className="ml-auto text-xs text-white/50">{accessItem.progress}%</div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-3xl border border-white/10 bg-white/5 p-6 text-white/60">
          {locale === "zh" ? "\u6682\u65e0\u8bfe\u7a0b\u3002" : "No courses yet."}
        </div>
      )}

      {activeGroupApproved && activeCourses.length ? (
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
    </div>
  );
}
