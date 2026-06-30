"use client";

import React from "react";
import { useRouter } from "next/navigation";

import { ClientDateTime } from "@/components/system/ClientDateTime";
import { PaginationControls } from "@/components/ui/PaginationControls";
import { usePagination } from "@/components/ui/usePagination";
import { fetchSystemJson } from "@/lib/system/clientFetch";
import {
  COURSE_TYPE_ADVANCED,
  COURSE_TYPE_COGNITIVE,
  COURSE_TYPE_MODEL,
  COURSE_TYPE_MOJING,
  getCourseTypeLabel,
  normalizeCourseType,
  type CourseType
} from "@/lib/system/courseTypes";
import { useSystemRealtimeRefresh } from "@/lib/system/useSystemRealtimeRefresh";

type LeaderProfile = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  role: string;
  status: "active" | "frozen";
  created_at?: string | null;
  last_login_at?: string | null;
};

type TeamStudent = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  role: string;
  status: "active" | "frozen";
  student_status: string;
  created_at?: string | null;
  last_login_at?: string | null;
};

type TeamLeader = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  status: "active" | "frozen";
  created_at?: string | null;
  last_login_at?: string | null;
};

type AccessRow = {
  id: string;
  course_id: number;
  status: string;
  progress: number;
  requested_at?: string | null;
  reviewed_at?: string | null;
  rejection_reason?: string | null;
};

type CourseRow = {
  id: number;
  course_type?: string | null;
  sort_order?: number | null;
  title_zh?: string | null;
  title_en?: string | null;
};

type GroupAccessRow = {
  id: string;
  course_type: string;
  status: string;
  reviewed_at?: string | null;
  reviewed_by?: string | null;
  rejection_reason?: string | null;
};

type LeaderDetailResponse = {
  ok?: boolean;
  error?: string;
  leader?: LeaderProfile | null;
  team?: {
    students?: TeamStudent[];
    leaders?: TeamLeader[];
    summary?: {
      students?: number;
      frozenStudents?: number;
      leaders?: number;
      frozenLeaders?: number;
      byStatus?: Record<string, number>;
    };
  };
  access?: AccessRow[];
  courses?: CourseRow[];
  groupAccess?: GroupAccessRow[];
  teamWarning?: string | null;
  courseWarning?: string | null;
};

function roleLabel(locale: "zh" | "en", role: string) {
  if (locale === "en") return role;
  if (role === "leader") return "团队长";
  if (role === "trader") return "数据采集员";
  if (role === "coach") return "教练";
  if (role === "student") return "学员";
  return role || "-";
}

function statusBadgeClass(status: string) {
  return status === "frozen"
    ? "border-rose-300/25 bg-rose-500/10 text-rose-100"
    : "border-emerald-300/25 bg-emerald-500/10 text-emerald-100";
}

function Field({
  label,
  children
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.045] px-4 py-3">
      <div className="text-xs text-white/45">{label}</div>
      <div className="mt-1 text-sm font-semibold text-white/86">{children || "-"}</div>
    </div>
  );
}

export function AdminLeaderDetailClient({
  locale,
  leaderId
}: {
  locale: "zh" | "en";
  leaderId: string;
}) {
  const router = useRouter();
  const [leader, setLeader] = React.useState<LeaderProfile | null>(null);
  const [students, setStudents] = React.useState<TeamStudent[]>([]);
  const [leaders, setLeaders] = React.useState<TeamLeader[]>([]);
  const [access, setAccess] = React.useState<AccessRow[]>([]);
  const [courses, setCourses] = React.useState<CourseRow[]>([]);
  const [groupAccess, setGroupAccess] = React.useState<GroupAccessRow[]>([]);
  const [summary, setSummary] = React.useState<NonNullable<LeaderDetailResponse["team"]>["summary"] | null>(null);
  const [teamWarning, setTeamWarning] = React.useState<string | null>(null);
  const [courseWarning, setCourseWarning] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchSystemJson<LeaderDetailResponse>(`/api/system/admin/leaders/${leaderId}`, {
        dedupeKey: `leader-detail:${leaderId}`,
        dedupeWindowMs: 800,
        retries: 2,
        retryBaseMs: 260,
        retryMaxMs: 1500
      });
      const json = (result.body || null) as LeaderDetailResponse | null;
      if (!result.ok || !json?.ok) throw new Error(json?.error || result.errorCode || "load_failed");
      if (!json.leader) throw new Error("NOT_FOUND");

      setLeader(json.leader);
      setStudents(Array.isArray(json.team?.students) ? json.team!.students! : []);
      setLeaders(Array.isArray(json.team?.leaders) ? json.team!.leaders! : []);
      setAccess(Array.isArray(json.access) ? json.access : []);
      setCourses(Array.isArray(json.courses) ? json.courses : []);
      setGroupAccess(Array.isArray(json.groupAccess) ? json.groupAccess : []);
      setSummary(json.team?.summary || null);
      setTeamWarning(json.teamWarning || null);
      setCourseWarning(json.courseWarning || null);
    } catch (err: any) {
      setError(err?.message || "load_failed");
    } finally {
      setLoading(false);
    }
  }, [leaderId]);

  React.useEffect(() => {
    load();
  }, [load]);

  useSystemRealtimeRefresh(load, {
    tables: ["profiles", "course_access", "course_group_access"],
    throttleMs: 3000,
    globalThrottleMs: 3600,
    dedupeKey: `leader-detail:${leaderId}`
  });

  const {
    pageItems: studentItems,
    page: studentPage,
    pageSize: studentPageSize,
    setPage: setStudentPage,
    setPageSize: setStudentPageSize,
    pageCount: studentPageCount,
    total: studentTotal
  } = usePagination(students);

  const {
    pageItems: leaderItems,
    page: leaderPage,
    pageSize: leaderPageSize,
    setPage: setLeaderPage,
    setPageSize: setLeaderPageSize,
    pageCount: leaderPageCount,
    total: leaderTotal
  } = usePagination(leaders);

  const accessByCourseId = React.useMemo(() => new Map(access.map((item) => [item.course_id, item])), [access]);
  const groupAccessByType = React.useMemo(() => {
    const map = new Map<CourseType, GroupAccessRow>();
    groupAccess.forEach((item) => {
      map.set(normalizeCourseType(item.course_type), item);
    });
    return map;
  }, [groupAccess]);
  const sortedIndividualCourses = React.useMemo(
    () =>
      courses
        .filter((course) => {
          const type = normalizeCourseType(course.course_type);
          return type === COURSE_TYPE_COGNITIVE || type === COURSE_TYPE_ADVANCED;
        })
        .slice()
        .sort((a, b) => {
          const typeA = normalizeCourseType(a.course_type);
          const typeB = normalizeCourseType(b.course_type);
          const typeOrderA = typeA === COURSE_TYPE_COGNITIVE ? 0 : 1;
          const typeOrderB = typeB === COURSE_TYPE_COGNITIVE ? 0 : 1;
          return typeOrderA - typeOrderB || Number(a.sort_order ?? a.id) - Number(b.sort_order ?? b.id) || a.id - b.id;
        }),
    [courses]
  );
  const cognitiveCourses = React.useMemo(
    () => sortedIndividualCourses.filter((course) => normalizeCourseType(course.course_type) === COURSE_TYPE_COGNITIVE),
    [sortedIndividualCourses]
  );
  const advancedCourses = React.useMemo(
    () => sortedIndividualCourses.filter((course) => normalizeCourseType(course.course_type) === COURSE_TYPE_ADVANCED),
    [sortedIndividualCourses]
  );

  const updateLeaderCourseAccess = React.useCallback(
    async (payload: unknown, confirmText: string) => {
      if (!leader) return;
      const ok = window.confirm(confirmText);
      if (!ok) return;
      setBusy(true);
      setError(null);
      try {
        const result = await fetchSystemJson(`/api/system/admin/leaders/${leader.id}/course-access`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
          dedupeWindowMs: 260,
          retries: 1,
          retryBaseMs: 220,
          retryMaxMs: 1200
        });
        const json = (result.body || null) as any;
        if (!result.ok || !json?.ok) throw new Error(json?.error || result.errorCode || "update_failed");
        void load();
      } catch (err: any) {
        setError(err?.message || "update_failed");
      } finally {
        setBusy(false);
      }
    },
    [leader, load]
  );

  const setCourseTypeAccess = React.useCallback(
    (courseType: CourseType, courseIds: number[]) => {
      const label = getCourseTypeLabel(courseType, locale);
      const count = courseIds.length;
      void updateLeaderCourseAccess(
        { mode: "course-type-set", courseType, courseIds },
        locale === "zh"
          ? `确认将该团队长${label}调整为开通 ${count} 节？`
          : `Set this leader's ${label} access to ${count} lessons?`
      );
    },
    [locale, updateLeaderCourseAccess]
  );

  const closeAllCourseAccess = React.useCallback(() => {
    void updateLeaderCourseAccess(
      { mode: "close-all" },
      locale === "zh" ? "确认关闭该团队长所有课程权限？" : "Revoke all course access for this leader?"
    );
  }, [locale, updateLeaderCourseAccess]);

  const updateGroupCourseAccess = React.useCallback(
    (courseType: CourseType, action: "approve" | "reject") => {
      const label = getCourseTypeLabel(courseType, locale);
      void updateLeaderCourseAccess(
        { mode: "group", courseType, action },
        locale === "zh"
          ? action === "approve"
            ? `确认开通${label}？`
            : `确认关闭${label}？`
          : action === "approve"
            ? `Approve ${label}?`
            : `Revoke ${label}?`
      );
    },
    [locale, updateLeaderCourseAccess]
  );

  const updateIndividualCourseAccess = React.useCallback(
    (course: CourseRow, enabled: boolean) => {
      const courseType = normalizeCourseType(course.course_type);
      const coursePool =
        courseType === COURSE_TYPE_COGNITIVE
          ? cognitiveCourses
          : courseType === COURSE_TYPE_ADVANCED
            ? advancedCourses
            : [];
      const selected = new Set(
        coursePool
          .filter((item) => {
            if (item.id === course.id) return !enabled;
            const row = accessByCourseId.get(item.id);
            return row?.status === "approved" || row?.status === "completed";
          })
          .map((item) => item.id)
      );
      const label = locale === "zh" ? course.title_zh || `第${course.id}课` : course.title_en || `Lesson ${course.id}`;
      void updateLeaderCourseAccess(
        { mode: "course-type-set", courseType, courseIds: Array.from(selected) },
        locale === "zh"
          ? enabled
            ? `确认关闭 ${label}？`
            : `确认开通 ${label}？`
          : enabled
            ? `Revoke ${label}?`
            : `Approve ${label}?`
      );
    },
    [accessByCourseId, advancedCourses, cognitiveCourses, locale, updateLeaderCourseAccess]
  );

  const goBack = React.useCallback(() => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
      return;
    }
    router.push(`/${locale}/system/admin/leaders`);
  }, [locale, router]);

  const studentStatusEntries = React.useMemo(
    () => Object.entries(summary?.byStatus || {}).sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0)),
    [summary?.byStatus]
  );

  return (
    <div className="space-y-6">
      {loading ? (
        <div className="rounded-3xl border border-white/10 bg-white/5 p-6 text-white/60">
          {locale === "zh" ? "加载中..." : "Loading..."}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-3xl border border-rose-400/20 bg-rose-500/10 p-6 text-rose-100">{error}</div>
      ) : null}

      {leader ? (
        <>
          <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={goBack}
                className="inline-flex items-center rounded-xl border border-white/15 bg-white/5 px-3 py-1.5 text-xs text-white/80 hover:bg-white/10"
              >
                {locale === "zh" ? "返回上一页" : "Back"}
              </button>
              <div className="text-xl font-semibold text-white/92">
                {leader.full_name || leader.email || (locale === "zh" ? "团队长详情" : "Leader details")}
              </div>
              <div className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusBadgeClass(leader.status)}`}>
                {leader.status}
              </div>
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <Field label={locale === "zh" ? "姓名" : "Name"}>{leader.full_name || "-"}</Field>
              <Field label={locale === "zh" ? "邮箱" : "Email"}>{leader.email || "-"}</Field>
              <Field label={locale === "zh" ? "手机号" : "Phone"}>{leader.phone || "-"}</Field>
              <Field label={locale === "zh" ? "角色" : "Role"}>{roleLabel(locale, leader.role)}</Field>
              <Field label={locale === "zh" ? "注册时间" : "Created"}>
                <ClientDateTime value={leader.created_at} fallback="-" />
              </Field>
              <Field label={locale === "zh" ? "最后登录" : "Last login"}>
                <ClientDateTime value={leader.last_login_at} fallback="-" />
              </Field>
            </div>
          </div>

          {teamWarning ? (
            <div className="rounded-3xl border border-amber-300/20 bg-amber-400/10 p-5 text-sm text-amber-100">
              {locale === "zh"
                ? "团队数据暂时加载失败，已优先展示团队长基本档案。"
                : "Team data failed to load. Showing the leader profile first."}
            </div>
          ) : null}

          <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
            <div className="text-xl font-semibold text-white/92">
              {locale === "zh" ? "直属团队概览" : "Direct Team Overview"}
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-4">
              <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-4">
                <div className="text-xs text-white/50">{locale === "zh" ? "直属学员/采集/教练" : "Direct learners"}</div>
                <div className="mt-2 text-3xl font-semibold text-white">{summary?.students ?? students.length}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-4">
                <div className="text-xs text-white/50">{locale === "zh" ? "冻结成员" : "Frozen members"}</div>
                <div className="mt-2 text-3xl font-semibold text-white">{summary?.frozenStudents ?? 0}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-4">
                <div className="text-xs text-white/50">{locale === "zh" ? "直属团队长" : "Direct leaders"}</div>
                <div className="mt-2 text-3xl font-semibold text-white">{summary?.leaders ?? leaders.length}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-4">
                <div className="text-xs text-white/50">{locale === "zh" ? "冻结团队长" : "Frozen leaders"}</div>
                <div className="mt-2 text-3xl font-semibold text-white">{summary?.frozenLeaders ?? 0}</div>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {studentStatusEntries.length ? (
                studentStatusEntries.map(([status, count]) => (
                  <div key={status} className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/70">
                    {status}: <span className="font-semibold text-white/90">{count}</span>
                  </div>
                ))
              ) : (
                <div className="text-sm text-white/50">{locale === "zh" ? "暂无状态统计" : "No status stats"}</div>
              )}
            </div>
          </div>

          {courseWarning ? (
            <div className="rounded-3xl border border-amber-300/20 bg-amber-400/10 p-5 text-sm text-amber-100">
              {locale === "zh"
                ? "课程授权数据暂时加载失败，请稍后刷新。"
                : "Course access data failed to load. Please refresh later."}
            </div>
          ) : null}

          <div className="rounded-3xl border border-white/10 bg-white/5 overflow-hidden">
            <div className="border-b border-white/10 px-6 py-4">
              <div className="text-white/85 font-semibold">{locale === "zh" ? "课程状态" : "Course access"}</div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy || !cognitiveCourses.length}
                  onClick={() => setCourseTypeAccess(COURSE_TYPE_COGNITIVE, cognitiveCourses.map((course) => course.id))}
                  className="px-3 py-1.5 rounded-xl border border-white/10 bg-white/5 text-xs text-white/80 hover:bg-white/10 disabled:opacity-50"
                >
                  {locale === "zh" ? "开通全部认知课程" : "Open all cognitive courses"}
                </button>
                <button
                  type="button"
                  disabled={busy || !advancedCourses.length}
                  onClick={() => setCourseTypeAccess(COURSE_TYPE_ADVANCED, advancedCourses.map((course) => course.id))}
                  className="px-3 py-1.5 rounded-xl border border-white/10 bg-white/5 text-xs text-white/80 hover:bg-white/10 disabled:opacity-50"
                >
                  {locale === "zh" ? "开通全部交易课程" : "Open all trading courses"}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={closeAllCourseAccess}
                  className="px-3 py-1.5 rounded-xl border border-rose-400/20 bg-rose-500/10 text-xs text-rose-100 hover:bg-rose-500/15 disabled:opacity-50"
                >
                  {locale === "zh" ? "关闭所有课程" : "Revoke all courses"}
                </button>
              </div>
            </div>
            <div className="divide-y divide-white/10">
              {sortedIndividualCourses.map((course) => {
                const row = accessByCourseId.get(course.id);
                const enabled = row?.status === "approved" || row?.status === "completed";
                const courseType = normalizeCourseType(course.course_type);
                return (
                  <div key={course.id} className="px-6 py-3 flex items-center gap-3 text-sm">
                    <div className="w-28 text-white/80">
                      <div>{getCourseTypeLabel(courseType, locale)}</div>
                      <div className="text-xs text-white/45">#{course.sort_order ?? course.id}</div>
                    </div>
                    <div className="min-w-0 flex-1 truncate text-white/70">
                      {locale === "zh" ? course.title_zh || `第${course.id}课` : course.title_en || `Lesson ${course.id}`}
                    </div>
                    <div className="text-white/60">{row?.status || "none"}</div>
                    <div className="ml-auto flex items-center gap-2">
                      <div className="text-white/50">{typeof row?.progress === "number" ? `${row.progress}%` : "-"}</div>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => updateIndividualCourseAccess(course, enabled)}
                        className="px-2.5 py-1 rounded-lg border border-white/10 bg-white/5 text-xs text-white/80 hover:bg-white/10 disabled:opacity-50"
                      >
                        {enabled ? (locale === "zh" ? "关闭" : "Revoke") : locale === "zh" ? "开通" : "Approve"}
                      </button>
                    </div>
                  </div>
                );
              })}
              {!sortedIndividualCourses.length ? <div className="px-6 py-4 text-white/60">-</div> : null}
              {([COURSE_TYPE_MODEL, COURSE_TYPE_MOJING] as CourseType[]).map((courseType) => {
                const row = groupAccessByType.get(courseType);
                const enabled = row?.status === "approved";
                return (
                  <div key={courseType} className="px-6 py-3 flex items-center gap-3 text-sm">
                    <div className="w-28 text-white/80">{getCourseTypeLabel(courseType, locale)}</div>
                    <div className="text-white/60">{row?.status || "none"}</div>
                    <div className="ml-auto">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => updateGroupCourseAccess(courseType, enabled ? "reject" : "approve")}
                        className="px-2.5 py-1 rounded-lg border border-white/10 bg-white/5 text-xs text-white/80 hover:bg-white/10 disabled:opacity-50"
                      >
                        {enabled ? (locale === "zh" ? "关闭" : "Revoke") : locale === "zh" ? "开通" : "Approve"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/5 overflow-hidden">
            <div className="border-b border-white/10 px-6 py-4 text-white/85 font-semibold">
              {locale === "zh" ? "直属学员 / 数据采集员 / 教练" : "Direct Learners / Traders / Coaches"}
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-xs text-white/50">
                  <tr className="border-b border-white/10">
                    <th className="px-4 py-3 text-left">{locale === "zh" ? "姓名" : "Name"}</th>
                    <th className="px-4 py-3 text-left">{locale === "zh" ? "邮箱" : "Email"}</th>
                    <th className="px-4 py-3 text-left">{locale === "zh" ? "手机号" : "Phone"}</th>
                    <th className="px-4 py-3 text-left">{locale === "zh" ? "角色" : "Role"}</th>
                    <th className="px-4 py-3 text-left">{locale === "zh" ? "学员状态" : "Student status"}</th>
                    <th className="px-4 py-3 text-left">{locale === "zh" ? "账号" : "Account"}</th>
                    <th className="px-4 py-3 text-left">{locale === "zh" ? "最近登录" : "Last login"}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10">
                  {studentItems.map((item) => (
                    <tr key={item.id} className="hover:bg-white/5">
                      <td className="px-4 py-3 font-semibold text-white/86">{item.full_name || "-"}</td>
                      <td className="px-4 py-3 text-white/70">{item.email || "-"}</td>
                      <td className="px-4 py-3 text-white/70">{item.phone || "-"}</td>
                      <td className="px-4 py-3 text-white/70">{roleLabel(locale, item.role)}</td>
                      <td className="px-4 py-3 text-white/70">{item.student_status || "-"}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full border px-2.5 py-1 text-xs ${statusBadgeClass(item.status)}`}>
                          {item.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-white/60">
                        <ClientDateTime value={item.last_login_at} fallback="-" />
                      </td>
                    </tr>
                  ))}
                  {!students.length ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-5 text-center text-white/60">
                        {locale === "zh" ? "暂无直属成员" : "No direct members"}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            {students.length ? (
              <PaginationControls
                total={studentTotal}
                page={studentPage}
                pageSize={studentPageSize}
                pageCount={studentPageCount}
                onPageChange={setStudentPage}
                onPageSizeChange={setStudentPageSize}
                locale={locale}
              />
            ) : null}
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/5 overflow-hidden">
            <div className="border-b border-white/10 px-6 py-4 text-white/85 font-semibold">
              {locale === "zh" ? "直属下级团队长" : "Direct Sub-leaders"}
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-xs text-white/50">
                  <tr className="border-b border-white/10">
                    <th className="px-4 py-3 text-left">{locale === "zh" ? "姓名" : "Name"}</th>
                    <th className="px-4 py-3 text-left">{locale === "zh" ? "邮箱" : "Email"}</th>
                    <th className="px-4 py-3 text-left">{locale === "zh" ? "手机号" : "Phone"}</th>
                    <th className="px-4 py-3 text-left">{locale === "zh" ? "账号" : "Account"}</th>
                    <th className="px-4 py-3 text-left">{locale === "zh" ? "最近登录" : "Last login"}</th>
                    <th className="px-4 py-3 text-right">{locale === "zh" ? "操作" : "Action"}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10">
                  {leaderItems.map((item) => (
                    <tr key={item.id} className="hover:bg-white/5">
                      <td className="px-4 py-3 font-semibold text-white/86">{item.full_name || "-"}</td>
                      <td className="px-4 py-3 text-white/70">{item.email || "-"}</td>
                      <td className="px-4 py-3 text-white/70">{item.phone || "-"}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full border px-2.5 py-1 text-xs ${statusBadgeClass(item.status)}`}>
                          {item.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-white/60">
                        <ClientDateTime value={item.last_login_at} fallback="-" />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => router.push(`/${locale}/system/admin/leaders/${item.id}`)}
                          className="rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/75 hover:bg-white/10"
                        >
                          {locale === "zh" ? "查看" : "View"}
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!leaders.length ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-5 text-center text-white/60">
                        {locale === "zh" ? "暂无直属下级团队长" : "No direct sub-leaders"}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            {leaders.length ? (
              <PaginationControls
                total={leaderTotal}
                page={leaderPage}
                pageSize={leaderPageSize}
                pageCount={leaderPageCount}
                onPageChange={setLeaderPage}
                onPageSizeChange={setLeaderPageSize}
                locale={locale}
              />
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
