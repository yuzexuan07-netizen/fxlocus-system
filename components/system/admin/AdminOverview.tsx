"use client";

import React from "react";

import { EChart } from "@/components/system/charts/EChart";
import { ClientDateTime } from "@/components/system/ClientDateTime";
import { PaginationControls } from "@/components/ui/PaginationControls";
import { usePagination } from "@/components/ui/usePagination";
import { fetchSystemJson } from "@/lib/system/clientFetch";
import { acquireGlobalPollSlot } from "@/lib/system/clientPolling";
import { useSystemRealtimeRefresh } from "@/lib/system/useSystemRealtimeRefresh";

type Summary = {
  ok: true;
  role: "leader" | "super_admin" | "assistant" | "coach";
  warning?: string;
  students: { total: number; frozen: number; inTraining: number; byStatus: Record<string, number> };
  inTrainingStudents?: Array<{
    id: string;
    name: string;
    email: string;
    role: string;
    student_status: string;
    status: string;
    leader_id: string;
    reasons: Array<"role" | "donation" | "course">;
  }>;
  leaders: { total: number };
  traders: { total: number };
  coaches: { total: number };
  assistants: { total: number };
  leaderTeams: Array<{
    leader_id: string;
    leader_name: string;
    leader_email: string;
    students: number;
    traders: number;
    leaders: number;
  }>;
  courses: Record<"requested" | "approved" | "rejected" | "completed", number>;
  pending: { courseAccessRequests: number; fileAccessRequests: number };
  generatedAt: string;
};

function makeStudentStatus3DOption(locale: "zh" | "en", byStatus: Record<string, number>) {
  const labels = Object.keys(byStatus);
  const max = Math.max(1, ...labels.map((label) => Number(byStatus[label] || 0)));
  const data = labels.map((label, idx) => [idx, 0, Number(byStatus[label] || 0)]);

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
        return `${label}<br/>${locale === "zh" ? "学员数" : "Students"}: ${cz ?? 0}`;
      }
    },
    visualMap: {
      show: false,
      min: 0,
      max,
      inRange: { color: ["#1e3a8a", "#38bdf8", "#f59e0b"] }
    },
    xAxis3D: {
      type: "category",
      data: labels,
      name: locale === "zh" ? "学员状态" : "Student status",
      axisLabel: { color: "rgba(255,255,255,0.8)" },
      axisLine: { lineStyle: { color: "rgba(255,255,255,0.3)" } }
    },
    yAxis3D: {
      type: "category",
      data: [locale === "zh" ? "学员数" : "Students"],
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
      boxWidth: 180,
      boxDepth: 36,
      boxHeight: 80,
      viewControl: {
        alpha: 25,
        beta: 35,
        distance: 200,
        autoRotate: true,
        autoRotateSpeed: 12,
        autoRotateAfterStill: 4,
        damping: 0.45
      },
      light: { main: { intensity: 1.15, shadow: true }, ambient: { intensity: 0.35 } }
    },
    series: [
      {
        type: "bar3D",
        data,
        shading: "realistic",
        bevelSize: 0.3,
        realisticMaterial: { roughness: 0.25, metalness: 0.1 }
      }
    ]
  };
}

function makeTotalsBar(
  locale: "zh" | "en",
  leaders: number,
  traders: number,
  coaches: number,
  assistants: number,
  students: number
) {
  const labels = [
    locale === "zh" ? "团队长" : "Leaders",
    locale === "zh" ? "数据采集员" : "Data Collectors",
    locale === "zh" ? "教练" : "Coaches",
    locale === "zh" ? "助教" : "Assistants",
    locale === "zh" ? "学员" : "Students"
  ];
  const values = [leaders, traders, coaches, assistants, students].map((v) => Number(v || 0));
  const max = Math.max(1, ...values);
  const data = values.map((value, idx) => [idx, 0, value]);
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
        return `${label}<br/>${locale === "zh" ? "数量" : "Count"}: ${cz ?? 0}`;
      }
    },
    xAxis3D: {
      type: "category",
      data: labels,
      name: locale === "zh" ? "角色" : "Role",
      axisLabel: { color: "rgba(255,255,255,0.8)" },
      axisLine: { lineStyle: { color: "rgba(255,255,255,0.3)" } }
    },
    yAxis3D: {
      type: "category",
      data: [locale === "zh" ? "总数" : "Total"],
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
      boxWidth: 140,
      boxDepth: 32,
      boxHeight: 80,
      viewControl: {
        alpha: 28,
        beta: 30,
        distance: 200,
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
        realisticMaterial: { roughness: 0.2, metalness: 0.12 },
        itemStyle: { color: "#38bdf8" }
      }
    ],
    title: {
      text: locale === "zh" ? "角色规模" : "Role totals",
      left: "center",
      top: 12,
      textStyle: { color: "rgba(255,255,255,0.85)", fontSize: 14 }
    }
  };
}

function makeLeaderTeamsBar(
  locale: "zh" | "en",
  teams: Summary["leaderTeams"]
) {
  const sorted = [...teams].sort(
    (a, b) => b.students + b.traders + b.leaders - (a.students + a.traders + a.leaders)
  );
  const top = sorted.slice(0, 12);
  const labels = top.map((t) => (t.leader_name || t.leader_email || t.leader_id).slice(0, 10));
  const categories = [
    locale === "zh" ? "学员" : "Students",
    locale === "zh" ? "数据采集员" : "Data Collectors",
    locale === "zh" ? "下属团队长" : "Sub-leaders"
  ];
  const data: Array<[number, number, number]> = [];
  top.forEach((team, x) => {
    data.push([x, 0, Number(team.students || 0)]);
    data.push([x, 1, Number(team.traders || 0)]);
    data.push([x, 2, Number(team.leaders || 0)]);
  });
  const max = Math.max(1, ...data.map((row) => row[2]));

  return {
    animation: true,
    animationDuration: 1200,
    animationEasing: "cubicOut",
    animationDurationUpdate: 1800,
    animationEasingUpdate: "cubicInOut",
    tooltip: {
      formatter: (p: any) => {
        const [cx, cy, cz] = p?.value || [];
        const leader = labels[Number(cx)] || "-";
        const category = categories[Number(cy)] || "-";
        return `${leader}<br/>${category}: ${cz ?? 0}`;
      }
    },
    xAxis3D: {
      type: "category",
      data: labels,
      name: locale === "zh" ? "团队长" : "Leader",
      axisLabel: { color: "rgba(255,255,255,0.8)" },
      axisLine: { lineStyle: { color: "rgba(255,255,255,0.3)" } }
    },
    yAxis3D: {
      type: "category",
      data: categories,
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
      boxWidth: 240,
      boxDepth: 80,
      boxHeight: 90,
      viewControl: {
        alpha: 24,
        beta: 35,
        distance: 240,
        autoRotate: true,
        autoRotateSpeed: 8,
        autoRotateAfterStill: 4,
        damping: 0.5
      },
      light: { main: { intensity: 1.05, shadow: true }, ambient: { intensity: 0.3 } }
    },
    series: [
      {
        type: "bar3D",
        data,
        shading: "realistic",
        bevelSize: 0.28,
        realisticMaterial: { roughness: 0.3, metalness: 0.1 },
        itemStyle: { opacity: 0.9 }
      }
    ],
    title: {
      text: locale === "zh" ? "团队长名下分布（Top 12）" : "Leader breakdown (Top 12)",
      left: "center",
      top: 12,
      textStyle: { color: "rgba(255,255,255,0.85)", fontSize: 14 }
    }
  };
}

export function AdminOverview({ locale }: { locale: "zh" | "en" }) {
  const [data, setData] = React.useState<Summary | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async (force = false) => {
    if (!force && !acquireGlobalPollSlot("admin-overview:summary", 8000)) return;
    setLoading(true);
    setError(null);
    try {
      const result = await fetchSystemJson<Summary>("/api/system/admin/reports/summary", {
        dedupeKey: "admin-overview:summary",
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
  }, []);

  React.useEffect(() => {
    let alive = true;
    const safeLoad = async () => {
      if (!alive) return;
      await load(true);
    };
    safeLoad();
    return () => {
      alive = false;
    };
  }, [load]);
  useSystemRealtimeRefresh(() => load(false), {
    tables: [
      "profiles",
      "course_access",
      "file_access_requests",
      "trade_submissions",
      "weekly_summaries",
      "student_documents",
      "ladder_authorizations",
      "records",
      "notifications"
    ],
    throttleMs: 4000,
    globalThrottleMs: 5000,
    dedupeKey: "admin-overview:summary"
  });

  const chart = React.useMemo(() => {
    if (!data) return null;
    return makeStudentStatus3DOption(locale, data.students.byStatus);
  }, [data, locale]);
  const leaderTeams = React.useMemo(() => data?.leaderTeams ?? [], [data?.leaderTeams]);
  const {
    pageItems: leaderTeamItems,
    page,
    pageSize,
    setPage,
    setPageSize,
    pageCount,
    total
  } = usePagination(leaderTeams);
  const inTrainingStudents = React.useMemo(() => data?.inTrainingStudents ?? [], [data?.inTrainingStudents]);
  const {
    pageItems: inTrainingStudentItems,
    page: inTrainingPage,
    pageSize: inTrainingPageSize,
    setPage: setInTrainingPage,
    setPageSize: setInTrainingPageSize,
    pageCount: inTrainingPageCount,
    total: inTrainingTotal
  } = usePagination(inTrainingStudents);
  const totalsChart = React.useMemo(() => {
    if (!data) return null;
    return makeTotalsBar(
      locale,
      data.leaders.total,
      data.traders.total,
      data.coaches.total,
      data.assistants.total,
      data.students.total
    );
  }, [data, locale]);
  const leaderTeamsChart = React.useMemo(() => {
    if (!data || data.role !== "super_admin" || !leaderTeams.length) return null;
    return makeLeaderTeamsBar(locale, leaderTeams);
  }, [data, leaderTeams, locale]);

  const studentsTotal = data?.students.total ?? 0;
  const studentsFrozen = data?.students.frozen ?? 0;
  const studentsInTraining = data?.students.inTraining ?? 0;
  const requestedCount = data?.pending.courseAccessRequests ?? 0;
  const leadersTotal = data?.leaders.total ?? 0;
  const tradersTotal = data?.traders.total ?? 0;
  const coachesTotal = data?.coaches.total ?? 0;
  const assistantsTotal = data?.assistants.total ?? 0;
  const isSuper = data?.role === "super_admin";
  const traderLabel = locale === "zh" ? (isSuper ? "数据采集员" : "我的数据采集员") : isSuper ? "Data collectors" : "My data collectors";

  const roleLabel = React.useCallback(
    (role: string) => {
      if (locale !== "zh") return role || "-";
      if (role === "leader") return "\u56e2\u961f\u957f";
      if (role === "trader") return "数据采集员";
      if (role === "coach") return "\u6559\u7ec3";
      if (role === "assistant") return "\u52a9\u6559";
      if (role === "student") return "\u5b66\u5458";
      return role || "-";
    },
    [locale]
  );
  const reasonLabel = React.useCallback(
    (reason: "role" | "donation" | "course") => {
      if (locale !== "zh") {
        if (reason === "role") return "Role";
        if (reason === "donation") return "Donation";
        return "Course opened";
      }
      if (reason === "role") return "\u89d2\u8272\u8ba1\u5165";
      if (reason === "donation") return "\u6350\u8d60\u5b66\u5458";
      return "\u5df2\u5f00\u901a\u8bfe\u7a0b";
    },
    [locale]
  );

  const overviewTitle =
    data?.role === "assistant"
      ? locale === "zh"
        ? "助教概览"
        : "Assistant overview"
      : locale === "zh"
        ? "管理员概览"
        : "Admin overview";
  const warningMessage =
    data?.warning === "profiles_created_by_missing"
      ? locale === "zh"
        ? "未检测到 profiles.created_by 字段，请应用最新 D1 schema（d1/schema.sql）。"
        : "Missing profiles.created_by column. Apply the latest D1 schema (d1/schema.sql)."
      : data?.warning || null;

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
        <div className="text-white/90 font-semibold text-xl">{overviewTitle}</div>
        <div className="mt-2 text-white/60 text-sm">
          {locale === "zh"
            ? "学员数据与申请概览（含图表）。"
            : "Student and request overview with charts."}
        </div>
      </div>

      {loading ? (
        <div className="rounded-3xl border border-white/10 bg-white/5 p-6 text-white/60">
          {locale === "zh" ? "加载中…" : "Loading…"}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-3xl border border-rose-400/20 bg-rose-500/10 p-6 text-rose-100">
          {error}
        </div>
      ) : null}
      {warningMessage ? (
        <div className="rounded-3xl border border-sky-400/20 bg-sky-500/10 p-5 text-sm text-sky-100">
          {warningMessage}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-4 xl:grid-cols-8">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="text-xs text-white/50">{locale === "zh" ? "团队长" : "Leaders"}</div>
          <div className="mt-2 text-3xl font-semibold text-white">{leadersTotal}</div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="text-xs text-white/50">{traderLabel}</div>
          <div className="mt-2 text-3xl font-semibold text-white">{tradersTotal}</div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="text-xs text-white/50">{locale === "zh" ? "教练管理" : "Coaches"}</div>
          <div className="mt-2 text-3xl font-semibold text-white">{coachesTotal}</div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="text-xs text-white/50">{locale === "zh" ? "助教管理" : "Assistants"}</div>
          <div className="mt-2 text-3xl font-semibold text-white">{assistantsTotal}</div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="text-xs text-white/50">{locale === "zh" ? "学员总数" : "Students"}</div>
          <div className="mt-2 text-3xl font-semibold text-white">{studentsTotal}</div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="text-xs text-white/50">{locale === "zh" ? "\u5728\u8bad\u5b66\u5458" : "Active trainees"}</div>
          <div className="mt-2 text-3xl font-semibold text-white">{studentsInTraining}</div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="text-xs text-white/50">{locale === "zh" ? "冻结账号" : "Frozen"}</div>
          <div className="mt-2 text-3xl font-semibold text-white">{studentsFrozen}</div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="text-xs text-white/50">{locale === "zh" ? "课程待审批" : "Course requests"}</div>
          <div className="mt-2 text-3xl font-semibold text-white">{requestedCount}</div>
        </div>
      </div>

      <div className="rounded-3xl border border-white/10 bg-white/5 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-6 py-4">
          <div>
            <div className="text-white/85 font-semibold">{locale === "zh" ? "\u5728\u8bad\u5b66\u5458\u540d\u5355" : "Active trainee list"}</div>
            <div className="mt-1 text-xs text-white/45">
              {locale === "zh"
                ? "包含数据采集员、团队长、捐赠学员和已开通课程的学员，已排除冻结账号。"
                : "Data collectors, leaders, donation students, and users with opened courses; frozen accounts excluded."}
            </div>
          </div>
          <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-sm text-white/70">
            {locale === "zh" ? "\u5171" : "Total"} {inTrainingStudents.length}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-xs text-white/50">
              <tr className="border-b border-white/10">
                <th className="px-6 py-3 text-left !whitespace-nowrap">{locale === "zh" ? "\u59d3\u540d" : "Name"}</th>
                <th className="px-6 py-3 text-left">Email</th>
                <th className="px-6 py-3 text-left">{locale === "zh" ? "\u89d2\u8272" : "Role"}</th>
                <th className="px-6 py-3 text-left">{locale === "zh" ? "\u5b66\u5458\u72b6\u6001" : "Student status"}</th>
                <th className="px-6 py-3 text-left">{locale === "zh" ? "\u8ba1\u5165\u539f\u56e0" : "Reason"}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {inTrainingStudentItems.length ? (
                inTrainingStudentItems.map((row) => (
                  <tr key={row.id} className="hover:bg-white/5">
                    <td className="px-6 py-3 text-white/85 font-semibold !whitespace-nowrap">
                      {row.name || row.email || row.id}
                    </td>
                    <td className="px-6 py-3 text-white/65">{row.email || "-"}</td>
                    <td className="px-6 py-3 text-white/70">{roleLabel(row.role)}</td>
                    <td className="px-6 py-3 text-white/70">{row.student_status || "-"}</td>
                    <td className="px-6 py-3 text-white/70">
                      <div className="flex flex-wrap gap-2">
                        {row.reasons.map((reason) => (
                          <span key={reason} className="rounded-full border border-sky-400/20 bg-sky-500/10 px-2 py-0.5 text-xs text-sky-100">
                            {reasonLabel(reason)}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="px-6 py-6 text-center text-white/45" colSpan={5}>
                    {locale === "zh" ? "\u6682\u65e0\u5728\u8bad\u5b66\u5458" : "No active trainees"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {inTrainingStudents.length ? (
          <PaginationControls
            total={inTrainingTotal}
            page={inTrainingPage}
            pageSize={inTrainingPageSize}
            pageCount={inTrainingPageCount}
            onPageChange={setInTrainingPage}
            onPageSizeChange={setInTrainingPageSize}
            locale={locale}
          />
        ) : null}
      </div>

      {data ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
            <div className="text-white/85 font-semibold">{locale === "zh" ? "角色规模" : "Role totals"}</div>
            <div className="mt-4 h-[320px] w-full rounded-2xl border border-white/10 bg-[#050a14]/80">
              {totalsChart ? <EChart option={totalsChart as any} className="h-full w-full" /> : null}
            </div>
          </div>
          <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
            <div className="text-white/85 font-semibold">{locale === "zh" ? "3D 学员状态图表" : "3D student status"}</div>
            <div className="mt-4 h-[320px] w-full rounded-2xl border border-sky-500/20 bg-gradient-to-br from-[#0b1a2a]/80 via-[#060c18]/90 to-[#020712]">
              {chart ? <EChart option={chart as any} className="h-full w-full" /> : null}
            </div>
            <div className="mt-2 text-xs text-white/45">
              {data.generatedAt ? (
                <span>
                  {locale === "zh" ? "生成时间" : "Generated"}: <ClientDateTime value={data.generatedAt} />
                </span>
              ) : (
                ""
              )}
            </div>
          </div>
        </div>
      ) : null}

      {isSuper && leaderTeams.length ? (
        <div className="space-y-4">
          <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
            <div className="text-white/85 font-semibold">
              {locale === "zh" ? "团队长名下分布" : "Leader breakdown"}
            </div>
            <div className="mt-4 h-[340px] w-full rounded-2xl border border-white/10 bg-[#050a14]/80">
              {leaderTeamsChart ? <EChart option={leaderTeamsChart as any} className="h-full w-full" /> : null}
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/5 overflow-hidden">
            <div className="px-6 py-4 border-b border-white/10 text-white/85 font-semibold">
              {locale === "zh" ? "团队长明细" : "Leader details"}
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-xs text-white/50">
                  <tr className="border-b border-white/10">
                    <th className="px-6 py-3 text-left !whitespace-nowrap">
                      {locale === "zh" ? "团队长" : "Leader"}
                    </th>
                    <th className="px-6 py-3 text-left">{locale === "zh" ? "下属团队长" : "Sub-leaders"}</th>
                    <th className="px-6 py-3 text-left">{locale === "zh" ? "数据采集员" : "Data Collectors"}</th>
                    <th className="px-6 py-3 text-left">{locale === "zh" ? "学员" : "Students"}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10">
                  {leaderTeamItems.map((row) => (
                    <tr key={row.leader_id} className="hover:bg-white/5">
                      <td className="px-6 py-3 text-white/85 font-semibold !whitespace-nowrap">
                        {row.leader_name || row.leader_email || row.leader_id}
                      </td>
                      <td className="px-6 py-3 text-white/70">{row.leaders}</td>
                      <td className="px-6 py-3 text-white/70">{row.traders}</td>
                      <td className="px-6 py-3 text-white/70">{row.students}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {leaderTeams.length ? (
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
        </div>
      ) : null}
    </div>
  );
}
