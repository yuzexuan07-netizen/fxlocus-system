"use client";

import React from "react";

import { EChart } from "@/components/system/charts/EChart";
import { ClientDateTime } from "@/components/system/ClientDateTime";
import { fetchSystemJson } from "@/lib/system/clientFetch";
import { acquireGlobalPollSlot } from "@/lib/system/clientPolling";
import { useSystemRealtimeRefresh } from "@/lib/system/useSystemRealtimeRefresh";

type LeaderRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  role: "leader" | "super_admin";
};

type Summary = {
  ok: true;
  role: "leader" | "super_admin" | "coach";
  scope: { leaderId: string | null };
  students: { total: number; frozen: number; byStatus: Record<string, number> };
  coaches?: { total: number };
  courses: Record<"requested" | "approved" | "rejected" | "completed", number>;
  pending: { courseAccessRequests: number; fileAccessRequests: number };
  records: { donate: number; contact: number; enrollment: number; subscribe: number };
  downloads: { total: number };
  ladder: { requested: number; approved: number; rejected: number };
  generatedAt: string;
};

const COURSE_STATUSES = ["requested", "approved", "rejected", "completed"] as const;

function courseStatusLabel(value: (typeof COURSE_STATUSES)[number], locale: "zh" | "en") {
  const zh: Record<string, string> = {
    requested: "待审批",
    approved: "已通过",
    rejected: "已拒绝",
    completed: "已完成"
  };
  const en: Record<string, string> = {
    requested: "Requested",
    approved: "Approved",
    rejected: "Rejected",
    completed: "Completed"
  };
  return (locale === "zh" ? zh : en)[value] || value;
}

function makeBreathing3DBar({
  title,
  labels,
  values,
  yLabel,
  color
}: {
  title: string;
  labels: string[];
  values: number[];
  yLabel: string;
  color: string;
}) {
  const max = Math.max(1, ...values);
  const data = values.map((value, idx) => [idx, 0, value]);
  const boxWidth = Math.min(220, Math.max(140, labels.length * 18));
  return {
    animation: true,
    animationDuration: 1200,
    animationEasing: "cubicOut",
    animationDurationUpdate: 1800,
    animationEasingUpdate: "cubicInOut",
    tooltip: {
      formatter: (p: any) => {
        const [cx, _cy, cz] = p?.value || [];
        const label = labels[Number(cx)] || "-";
        return `${label}<br/>${yLabel}: ${cz ?? 0}`;
      }
    },
    xAxis3D: {
      type: "category",
      data: labels,
      axisLabel: { color: "rgba(255,255,255,0.8)" },
      axisLine: { lineStyle: { color: "rgba(255,255,255,0.3)" } }
    },
    yAxis3D: {
      type: "category",
      data: [yLabel],
      axisLabel: { color: "rgba(255,255,255,0.8)" },
      axisLine: { lineStyle: { color: "rgba(255,255,255,0.3)" } }
    },
    zAxis3D: {
      type: "value",
      min: 0,
      max,
      axisLabel: { color: "rgba(255,255,255,0.8)" },
      axisLine: { lineStyle: { color: "rgba(255,255,255,0.3)" } }
    },
    grid3D: {
      boxWidth,
      boxDepth: 32,
      boxHeight: 80,
      viewControl: {
        alpha: 28,
        beta: 30,
        distance: 210,
        autoRotate: true,
        autoRotateSpeed: 10,
        autoRotateAfterStill: 4,
        damping: 0.45
      },
      light: { main: { intensity: 1.1, shadow: true }, ambient: { intensity: 0.35 } }
    },
    series: [
      {
        type: "bar3D",
        data,
        shading: "realistic",
        bevelSize: 0.3,
        realisticMaterial: { roughness: 0.28, metalness: 0.08 },
        itemStyle: { color }
      }
    ],
    title: {
      text: title,
      left: "center",
      top: 12,
      textStyle: { color: "rgba(255,255,255,0.85)", fontSize: 14 }
    }
  };
}

function makeStudentStatusPie(locale: "zh" | "en", byStatus: Record<string, number>) {
  const labels = Object.keys(byStatus);
  const values = labels.map((label) => Number(byStatus[label] || 0));
  return makeBreathing3DBar({
    title: locale === "zh" ? "学员状态分布" : "Student status",
    labels,
    values,
    yLabel: locale === "zh" ? "学员" : "Students",
    color: "#22c55e"
  });
}

function makeCourseStatusBar(locale: "zh" | "en", courses: Summary["courses"]) {
  const labels = COURSE_STATUSES.map((s) => courseStatusLabel(s, locale));
  const values = COURSE_STATUSES.map((s) => Number(courses[s] || 0));
  return makeBreathing3DBar({
    title: locale === "zh" ? "课程申请/进度状态" : "Course access status",
    labels,
    values,
    yLabel: locale === "zh" ? "课程" : "Courses",
    color: "#38bdf8"
  });
}

function makePendingBar(locale: "zh" | "en", pending: Summary["pending"]) {
  const labels = [locale === "zh" ? "课程待审批" : "Course requests", locale === "zh" ? "文件待审批" : "File requests"];
  const values = [Number(pending.courseAccessRequests || 0), Number(pending.fileAccessRequests || 0)];
  return makeBreathing3DBar({
    title: locale === "zh" ? "待处理" : "Pending",
    labels,
    values,
    yLabel: locale === "zh" ? "待审" : "Pending",
    color: "#f59e0b"
  });
}

function makeRecordsBar(locale: "zh" | "en", records: Summary["records"]) {
  const labels = [
    locale === "zh" ? "捐赠" : "Donations",
    locale === "zh" ? "联系" : "Contacts",
    locale === "zh" ? "报名" : "Enrollments",
    locale === "zh" ? "订阅" : "Subscriptions"
  ];
  const values = [records.donate, records.contact, records.enrollment, records.subscribe].map((v) => Number(v || 0));
  return makeBreathing3DBar({
    title: locale === "zh" ? "表单提交统计" : "Form submissions",
    labels,
    values,
    yLabel: locale === "zh" ? "数量" : "Count",
    color: "#22c55e"
  });
}

function makeActivityBar(locale: "zh" | "en", summary: Summary) {
  const labels = [
    locale === "zh" ? "文件下载" : "Downloads",
    locale === "zh" ? "天梯申请" : "Ladder requested",
    locale === "zh" ? "天梯通过" : "Ladder approved",
    locale === "zh" ? "天梯拒绝" : "Ladder rejected"
  ];
  const values = [
    Number(summary.downloads.total || 0),
    Number(summary.ladder.requested || 0),
    Number(summary.ladder.approved || 0),
    Number(summary.ladder.rejected || 0)
  ];
  return makeBreathing3DBar({
    title: locale === "zh" ? "权限与下载" : "Access & downloads",
    labels,
    values,
    yLabel: locale === "zh" ? "数量" : "Count",
    color: "#a855f7"
  });
}

export function AdminReportsClient({
  locale,
  meRole
}: {
  locale: "zh" | "en";
  meRole: "leader" | "super_admin" | "coach";
}) {
  const [leaders, setLeaders] = React.useState<LeaderRow[]>([]);
  const [leaderId, setLeaderId] = React.useState<string>("");

  const [data, setData] = React.useState<Summary | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const loadSummary = React.useCallback(
    async (nextLeaderId: string, force = false) => {
      const slotKey = `admin-reports:summary:${nextLeaderId || "all"}`;
      if (!force && !acquireGlobalPollSlot(slotKey, 10_000)) return;
      setLoading(true);
      setError(null);
      try {
        const qs = nextLeaderId ? `?leaderId=${encodeURIComponent(nextLeaderId)}` : "";
        const result = await fetchSystemJson<Summary>(`/api/system/admin/reports/summary${qs}`, {
          dedupeKey: slotKey,
          retries: 2,
          retryBaseMs: 300,
          retryMaxMs: 1600
        });
        const json = (result.body || null) as any;
        if (!result.ok || !json?.ok) throw new Error(json?.error || result.errorCode || "load_failed");
        setData(json as Summary);
      } catch (e: any) {
        setError(e?.message || "load_failed");
      } finally {
        setLoading(false);
      }
    },
    []
  );

  React.useEffect(() => {
    loadSummary("", true);
  }, [loadSummary]);

  const loadLeaders = React.useCallback(async (force = false) => {
    if (meRole !== "super_admin") return;
    if (!force && !acquireGlobalPollSlot("admin-reports:leaders", 12_000)) return;
    try {
      const result = await fetchSystemJson<{ ok?: boolean; items?: LeaderRow[] }>("/api/system/admin/leaders/list", {
        dedupeKey: "admin-reports:leaders",
        retries: 1,
        dedupeWindowMs: 5000
      });
      const json = (result.body || null) as any;
      if (!result.ok || !json?.ok) return;
      const rows = (Array.isArray(json.items) ? json.items : []) as LeaderRow[];
      setLeaders(rows.filter((r) => r.role === "leader"));
    } catch {
      // ignore
    }
  }, [meRole]);

  React.useEffect(() => {
    loadLeaders(true);
  }, [loadLeaders]);

  const refresh = React.useCallback(() => {
    void loadSummary(leaderId, false);
    void loadLeaders(false);
  }, [leaderId, loadLeaders, loadSummary]);
  useSystemRealtimeRefresh(refresh, {
    tables: [
      "profiles",
      "course_access",
      "course_notes",
      "trade_submissions",
      "weekly_summaries",
      "classic_trades",
      "file_access_requests",
      "notifications"
    ],
    throttleMs: 5000,
    globalThrottleMs: 6000,
    dedupeKey: `admin-reports:${meRole}`
  });

  const studentPie = React.useMemo(() => (data ? makeStudentStatusPie(locale, data.students.byStatus) : null), [data, locale]);
  const courseBar = React.useMemo(() => (data ? makeCourseStatusBar(locale, data.courses) : null), [data, locale]);
  const pendingBar = React.useMemo(() => (data ? makePendingBar(locale, data.pending) : null), [data, locale]);
  const recordsBar = React.useMemo(() => (data ? makeRecordsBar(locale, data.records) : null), [data, locale]);
  const activityBar = React.useMemo(() => (data ? makeActivityBar(locale, data) : null), [data, locale]);

  const empty = !loading && !error && data && data.students.total === 0;

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
        <div className="text-white/90 font-semibold text-xl">{locale === "zh" ? "统计报表" : "Reports"}</div>
        <div className="mt-2 text-white/60 text-sm">
          {locale === "zh"
            ? meRole === "super_admin"
              ? "全局统计，可按团队长筛选。"
              : meRole === "leader"
                ? "仅统计你的团队数据（不含捐赠/联系记录）。"
                : "仅统计你负责的学员/数据采集员数据。"
            : meRole === "super_admin"
              ? "Global stats with leader filter."
              : meRole === "leader"
                ? "Team-scoped stats (no donate/contact records)."
                : "Coach-scoped stats for assigned learners."}
        </div>
      </div>

      {meRole === "super_admin" ? (
        <div className="rounded-3xl border border-white/10 bg-white/5 p-6 flex flex-wrap items-center gap-3">
          <div className="text-sm text-white/70">{locale === "zh" ? "团队长筛选" : "Leader filter"}</div>
          <select
            value={leaderId}
            onChange={(e) => {
              const v = e.target.value;
              setLeaderId(v);
              void loadSummary(v, true);
            }}
            className="rounded-xl border border-white/10 bg-[#050a14] px-3 py-2 text-white/85 text-sm"
          >
            <option value="">{locale === "zh" ? "全部" : "All"}</option>
            {leaders.map((l) => (
              <option key={l.id} value={l.id}>
                {(l.full_name || l.email || l.id).slice(0, 80)}
              </option>
            ))}
          </select>
          <div className="ml-auto text-xs text-white/45">
            {data?.generatedAt ? (
              <span>
                {locale === "zh" ? "生成时间" : "Generated"}: <ClientDateTime value={data.generatedAt} />
              </span>
            ) : (
              ""
            )}
          </div>
        </div>
      ) : (
        <div className="text-xs text-white/45">
          {data?.generatedAt ? (
            <span>
              {locale === "zh" ? "生成时间" : "Generated"}: <ClientDateTime value={data.generatedAt} />
            </span>
          ) : (
            ""
          )}
        </div>
      )}

      {loading ? <div className="rounded-3xl border border-white/10 bg-white/5 p-6 text-white/60">{locale === "zh" ? "加载中…" : "Loading…"}</div> : null}
      {error ? <div className="rounded-3xl border border-rose-400/20 bg-rose-500/10 p-6 text-rose-100">{error}</div> : null}

      {!loading && !error && data ? (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="text-xs text-white/50">{locale === "zh" ? "学员数" : "Students"}</div>
              <div className="mt-2 text-3xl font-semibold text-white">{data.students.total}</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="text-xs text-white/50">{locale === "zh" ? "冻结" : "Frozen"}</div>
              <div className="mt-2 text-3xl font-semibold text-white">{data.students.frozen}</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="text-xs text-white/50">{locale === "zh" ? "课程待审批" : "Course requests"}</div>
              <div className="mt-2 text-3xl font-semibold text-white">{data.pending.courseAccessRequests}</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="text-xs text-white/50">{locale === "zh" ? "文件待审批" : "File requests"}</div>
              <div className="mt-2 text-3xl font-semibold text-white">{data.pending.fileAccessRequests}</div>
            </div>
          </div>

          {meRole === "super_admin" ? (
            <div className="grid gap-4 md:grid-cols-4">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="text-xs text-white/50">{locale === "zh" ? "捐赠" : "Donations"}</div>
                <div className="mt-2 text-3xl font-semibold text-white">{data.records.donate}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="text-xs text-white/50">{locale === "zh" ? "联系" : "Contacts"}</div>
                <div className="mt-2 text-3xl font-semibold text-white">{data.records.contact}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="text-xs text-white/50">{locale === "zh" ? "报名" : "Enrollments"}</div>
                <div className="mt-2 text-3xl font-semibold text-white">{data.records.enrollment}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="text-xs text-white/50">{locale === "zh" ? "下载" : "Downloads"}</div>
                <div className="mt-2 text-3xl font-semibold text-white">{data.downloads.total}</div>
              </div>
            </div>
          ) : null}

          {empty ? (
            <div className="rounded-3xl border border-dashed border-white/15 bg-white/5 p-10 text-center text-white/60">
              {locale === "zh" ? "暂无数据" : "No data"}
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-3">
              <div className="rounded-3xl border border-white/10 bg-white/5 p-4 h-[380px]">
                {studentPie ? <EChart option={studentPie as any} className="h-full w-full" /> : null}
              </div>
              <div className="rounded-3xl border border-white/10 bg-white/5 p-4 h-[380px]">
                {courseBar ? <EChart option={courseBar as any} className="h-full w-full" /> : null}
              </div>
              <div className="rounded-3xl border border-white/10 bg-white/5 p-4 h-[380px]">
                {pendingBar ? <EChart option={pendingBar as any} className="h-full w-full" /> : null}
              </div>
              {meRole === "super_admin" ? (
                <div className="rounded-3xl border border-white/10 bg-white/5 p-4 h-[380px]">
                  {recordsBar ? <EChart option={recordsBar as any} className="h-full w-full" /> : null}
                </div>
              ) : null}
              {meRole === "super_admin" ? (
                <div className="rounded-3xl border border-white/10 bg-white/5 p-4 h-[380px]">
                  {activityBar ? <EChart option={activityBar as any} className="h-full w-full" /> : null}
                </div>
              ) : null}
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
