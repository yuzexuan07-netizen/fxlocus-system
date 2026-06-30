"use client";

import React from "react";

import { EChart } from "@/components/system/charts/EChart";
import { ClientDateTime } from "@/components/system/ClientDateTime";
import { StatusBadge } from "@/components/system/StatusBadge";
import { Link } from "@/i18n/navigation";
import { fetchSystemJson } from "@/lib/system/clientFetch";
import { useSystemRealtimeRefresh } from "@/lib/system/useSystemRealtimeRefresh";

type StudentSummary = {
  ok: true;
  kind: "student";
  role: "student" | "trader" | "coach";
  totalCourses: number;
  hasCourseChart: boolean;
  documentsSubmitted: boolean;
  showOnboardingGuide: boolean;
  counts: { completed: number; approved: number; requested: number };
  items: Array<{
    course_id: number;
    course_type: string;
    sort_order: number;
    title_zh: string | null;
    title_en: string | null;
    status: string;
    progress: number;
    updated_at: string | null;
  }>;
  latest: Array<{
    course_id: number;
    course_type: string;
    sort_order: number;
    title_zh: string | null;
    title_en: string | null;
    status: string;
    progress: number;
    updated_at: string | null;
  }>;
};

type AdminSummary = {
  ok: true;
  kind: "admin";
  role: "leader" | "super_admin";
  students: { total: number; frozen: number; byStatus: Record<string, number> };
  courses: Record<"requested" | "approved" | "rejected" | "completed", number>;
  pending: { fileAccessRequests: number };
};

type Summary = StudentSummary | AdminSummary;

const COURSE_STATUSES = ["requested", "approved", "completed", "rejected", "none"] as const;

function statusLabel(status: string, locale: "zh" | "en") {
  const mapZh: Record<string, string> = {
    requested: "已申请",
    approved: "已通过",
    rejected: "已拒绝",
    completed: "已完成",
    none: "未申请"
  };
  const mapEn: Record<string, string> = {
    requested: "Requested",
    approved: "Approved",
    rejected: "Rejected",
    completed: "Completed",
    none: "Not requested"
  };
  return (locale === "zh" ? mapZh : mapEn)[status] || status;
}

function getCourseLabel(locale: "zh" | "en", row: StudentSummary["items"][number]) {
  const title = locale === "zh" ? row.title_zh : row.title_en;
  if (title) return title;
  const order = Number(row.sort_order || row.course_id || 0);
  return locale === "zh" ? `第${order}课` : `Lesson ${order}`;
}

function buildStudent3DOption(locale: "zh" | "en", items: StudentSummary["items"]) {
  const x = items.map((item) => getCourseLabel(locale, item));
  const y = COURSE_STATUSES.map((s) => statusLabel(s, locale));

  const raw = items.map((row, idx) => {
    const st = (row?.status as any) || "none";
    const stIndex = COURSE_STATUSES.indexOf(st) >= 0 ? COURSE_STATUSES.indexOf(st) : COURSE_STATUSES.indexOf("none");
    const progress = Math.max(0, Math.min(100, Number(row?.progress || 0)));
    return [idx, stIndex, progress];
  });

  return {
    animation: true,
    animationDuration: 1200,
    animationEasing: "cubicOut",
    animationDurationUpdate: 1800,
    animationEasingUpdate: "cubicInOut",
    tooltip: {
      formatter: (p: any) => {
        const [cx, cy, cz] = p?.value || [];
        const courseLabel = x[Number(cx)] || "-";
        const statusText = y[Number(cy)] || "-";
        return `${courseLabel}<br/>${locale === "zh" ? "状态" : "Status"}: ${statusText}<br/>${
          locale === "zh" ? "进度" : "Progress"
        }: ${cz ?? 0}%`;
      }
    },
    visualMap: {
      show: false,
      min: 0,
      max: 100,
      inRange: { color: ["#1e3a8a", "#38bdf8", "#10b981"] }
    },
    xAxis3D: {
      type: "category",
      data: x,
      name: locale === "zh" ? "课节" : "Lesson",
      axisLabel: { color: "rgba(255,255,255,0.8)" },
      axisLine: { lineStyle: { color: "rgba(255,255,255,0.3)" } }
    },
    yAxis3D: {
      type: "category",
      data: y,
      name: locale === "zh" ? "状态" : "Status",
      axisLabel: { color: "rgba(255,255,255,0.8)" },
      axisLine: { lineStyle: { color: "rgba(255,255,255,0.3)" } }
    },
    zAxis3D: {
      type: "value",
      name: locale === "zh" ? "进度" : "Progress",
      min: 0,
      max: 100,
      axisLabel: { color: "rgba(255,255,255,0.8)" },
      axisLine: { lineStyle: { color: "rgba(255,255,255,0.3)" } }
    },
    grid3D: {
      boxWidth: 180,
      boxDepth: 80,
      boxHeight: 90,
      viewControl: {
        alpha: 30,
        beta: 20,
        distance: 220,
        autoRotate: true,
        autoRotateSpeed: 10,
        autoRotateAfterStill: 4,
        damping: 0.4
      },
      light: { main: { intensity: 1.2, shadow: true }, ambient: { intensity: 0.35 } }
    },
    series: [
      {
        type: "bar3D",
        data: raw,
        shading: "realistic",
        bevelSize: 0.3,
        realisticMaterial: { roughness: 0.25, metalness: 0.1 },
        label: { show: false }
      }
    ]
  };
}

function buildAdmin3DOption(locale: "zh" | "en", byStatus: Record<string, number>) {
  const statuses = Object.keys(byStatus);
  const x = statuses.map((s) => (locale === "zh" ? s : s));
  const y = [locale === "zh" ? "学员数" : "Students"];
  const max = Math.max(1, ...statuses.map((s) => Number(byStatus[s] || 0)));

  const data = statuses.map((s, idx) => [idx, 0, Number(byStatus[s] || 0)]);

  return {
    animation: true,
    animationDuration: 1200,
    animationEasing: "cubicOut",
    animationDurationUpdate: 1800,
    animationEasingUpdate: "cubicInOut",
    tooltip: {
      formatter: (p: any) => {
        const [cx, _cy, cz] = p?.value || [];
        const name = x[Number(cx)] || "-";
        return `${name}<br/>${y[0]}: ${cz ?? 0}`;
      }
    },
    visualMap: { show: false, min: 0, max, inRange: { color: ["#1e3a8a", "#38bdf8", "#f59e0b"] } },
    xAxis3D: {
      type: "category",
      data: x,
      name: locale === "zh" ? "学员状态" : "Student status",
      axisLabel: { color: "rgba(255,255,255,0.8)" },
      axisLine: { lineStyle: { color: "rgba(255,255,255,0.3)" } }
    },
    yAxis3D: {
      type: "category",
      data: y,
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
      boxWidth: 160,
      boxDepth: 40,
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
      light: { main: { intensity: 1.1, shadow: true }, ambient: { intensity: 0.3 } }
    },
    series: [
      {
        type: "bar3D",
        data,
        shading: "realistic",
        bevelSize: 0.3,
        realisticMaterial: { roughness: 0.28, metalness: 0.08 }
      }
    ]
  };
}

function StudentOnboardingGuide({ locale }: { locale: "zh" | "en" }) {
  const isZh = locale === "zh";
  const requiredFiles = isZh
    ? ["第一阶段", "MT4软件操作", "绿色免安装", "报名表"]
    : ["Stage 1", "MT4 software guide", "Portable green install package", "Enrollment form"];
  const steps = isZh
    ? [
        "先进入「系统接入：三日体验」，阅读三封信和流程说明，确认当前阶段要做什么。",
        "进入「文件」菜单，分别申请第一阶段、MT4软件操作、绿色免安装、报名表这四个资料。",
        "资料权限通过后，先学习文件内容；报名表需要下载填写，文件名用自己的姓名命名。",
        "学习和填写完毕后，进入「资料上传」，按提示上传报名表、试用界面截图和身份/学信资料。",
        "任何地方不清楚，直接进入「咨询」菜单联系团队长。"
      ]
    : [
        "Open System Access: 3-day Trial first and read the onboarding letters and flow.",
        "Go to Files and request Stage 1, MT4 software guide, portable green install package, and enrollment form.",
        "After approval, study the files; download and fill the enrollment form with your own name as the file name.",
        "Then go to Uploads and submit the enrollment form, trial UI screenshot, and identity/education images.",
        "If anything is unclear, use Consult to contact your leader."
      ];

  return (
    <section className="overflow-hidden rounded-3xl border border-sky-300/25 bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.28),transparent_35%),linear-gradient(135deg,rgba(14,165,233,0.14),rgba(15,23,42,0.72))] p-6 shadow-[0_24px_70px_-50px_rgba(56,189,248,0.85)]">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-3xl">
          <div className="text-xs font-semibold uppercase tracking-[0.22em] text-sky-100/65">
            {isZh ? "NEW STUDENT GUIDE" : "NEW STUDENT GUIDE"}
          </div>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">
            {isZh ? "新学员先按这 5 步走" : "Start with these 5 steps"}
          </h2>
          <p className="mt-3 text-sm leading-7 text-white/72">
            {isZh
              ? "如果你刚拿到账户，不需要猜下一步。先申请资料，学习后再上传资料，有问题通过咨询找团队长。"
              : "If you just received your account, follow this path: request files, study them, upload documents, and ask your leader through Consult."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 lg:max-w-sm lg:justify-end">
          {requiredFiles.map((name) => (
            <span key={name} className="rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs text-white/78">
              {name}
            </span>
          ))}
        </div>
      </div>

      <ol className="mt-6 grid gap-3 lg:grid-cols-5">
        {steps.map((step, idx) => (
          <li key={step} className="rounded-2xl border border-white/10 bg-black/18 p-4">
            <div className="mb-3 inline-flex h-8 w-8 items-center justify-center rounded-full bg-sky-300 text-sm font-bold text-slate-950">
              {idx + 1}
            </div>
            <div className="text-sm leading-6 text-white/78">{step}</div>
          </li>
        ))}
      </ol>

      <div className="mt-6 flex flex-wrap gap-3">
        <Link
          href="/system/trial-access"
          className="rounded-2xl border border-sky-200/35 bg-sky-300/90 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-sky-200"
        >
          {isZh ? "先看三日体验" : "Open trial access"}
        </Link>
        <Link
          href="/system/files"
          className="rounded-2xl border border-white/15 bg-white/10 px-4 py-2 text-sm text-white/86 hover:bg-white/15"
        >
          {isZh ? "去文件申请资料" : "Request files"}
        </Link>
        <Link
          href="/system/uploads"
          className="rounded-2xl border border-white/15 bg-white/10 px-4 py-2 text-sm text-white/86 hover:bg-white/15"
        >
          {isZh ? "去资料上传" : "Go to uploads"}
        </Link>
        <Link
          href="/system/consult"
          className="rounded-2xl border border-white/15 bg-white/10 px-4 py-2 text-sm text-white/86 hover:bg-white/15"
        >
          {isZh ? "咨询团队长" : "Consult leader"}
        </Link>
      </div>
    </section>
  );
}

function StudentOnboardingGuideV2({ locale }: { locale: "zh" | "en" }) {
  const isZh = locale === "zh";
  const requiredFiles = isZh
    ? ["第一阶段资料", "软件操作说明", "绿色安装包", "报名表"]
    : ["Stage 1", "Software guide", "Portable package", "Enrollment form"];
  const steps = isZh
    ? [
        "先进入「系统接入：三日体验」，阅读三封信和流程说明，确认当前阶段要做什么。",
        "进入「文件」菜单，申请第一阶段资料、软件操作说明、绿色安装包和报名表。",
        "资料权限通过后，先学习文件内容；报名表需要下载填写，文件名用自己的姓名命名。",
        "学习和填写完成后，进入「资料上传」，按提示上传报名表、试用界面截图和身份/学历资料。",
        "任何地方不清楚，直接进入「咨询」菜单联系团队长或助教。"
      ]
    : [
        "Open System Access: 3-day Trial first and read the onboarding letters and flow.",
        "Go to Files and request Stage 1, software guide, portable package, and enrollment form.",
        "After approval, study the files; download and fill the enrollment form with your own name as the file name.",
        "Then go to Uploads and submit the enrollment form, trial UI screenshot, and identity/education images.",
        "If anything is unclear, use Consult to contact your leader or assistant."
      ];

  return (
    <section className="overflow-hidden rounded-3xl border border-sky-300/25 bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.28),transparent_35%),linear-gradient(135deg,rgba(14,165,233,0.14),rgba(15,23,42,0.72))] p-6 shadow-[0_24px_70px_-50px_rgba(56,189,248,0.85)]">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-3xl">
          <div className="text-xs font-semibold uppercase tracking-[0.22em] text-sky-100/65">NEW STUDENT GUIDE</div>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">
            {isZh ? "新学员先按这 5 步走" : "Start with these 5 steps"}
          </h2>
          <p className="mt-3 text-sm leading-7 text-white/72">
            {isZh
              ? "这块只对新普通学员显示。捐赠学员、已开通资料、已提交入门资料或已进入训练的账号不会再显示。"
              : "This guide only appears for new normal students. Donation members, users with opened access, submitted onboarding documents, or active training status will not see it."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 lg:max-w-sm lg:justify-end">
          {requiredFiles.map((name) => (
            <span key={name} className="rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs text-white/78">
              {name}
            </span>
          ))}
        </div>
      </div>

      <ol className="mt-6 grid gap-3 lg:grid-cols-5">
        {steps.map((step, idx) => (
          <li key={step} className="rounded-2xl border border-white/10 bg-black/18 p-4">
            <div className="mb-3 inline-flex h-8 w-8 items-center justify-center rounded-full bg-sky-300 text-sm font-bold text-slate-950">
              {idx + 1}
            </div>
            <div className="text-sm leading-6 text-white/78">{step}</div>
          </li>
        ))}
      </ol>

      <div className="mt-6 flex flex-wrap gap-3">
        <Link
          href="/system/trial-access"
          className="rounded-2xl border border-sky-200/35 bg-sky-300/90 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-sky-200"
        >
          {isZh ? "先看三日体验" : "Open trial access"}
        </Link>
        <Link href="/system/files" className="rounded-2xl border border-white/15 bg-white/10 px-4 py-2 text-sm text-white/86 hover:bg-white/15">
          {isZh ? "去文件申请资料" : "Request files"}
        </Link>
        <Link href="/system/uploads" className="rounded-2xl border border-white/15 bg-white/10 px-4 py-2 text-sm text-white/86 hover:bg-white/15">
          {isZh ? "去资料上传" : "Go to uploads"}
        </Link>
        <Link href="/system/consult" className="rounded-2xl border border-white/15 bg-white/10 px-4 py-2 text-sm text-white/86 hover:bg-white/15">
          {isZh ? "咨询团队长" : "Consult leader"}
        </Link>
      </div>
    </section>
  );
}

export function DashboardClient({ locale }: { locale: "zh" | "en" }) {
  const [data, setData] = React.useState<Summary | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const aliveRef = React.useRef(true);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchSystemJson<Summary>("/api/system/dashboard/summary", {
        dedupeKey: "dashboard:summary",
        retries: 2,
        retryBaseMs: 260,
        retryMaxMs: 1400
      });
      const json = (result.body || null) as any;
      if (!aliveRef.current) return;
      if (!result.ok || !json?.ok) throw new Error(json?.error || result.errorCode || "load_failed");
      setData(json as Summary);
    } catch (e: any) {
      if (!aliveRef.current) return;
      setError(e?.message || "load_failed");
    } finally {
      if (!aliveRef.current) return;
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    aliveRef.current = true;
    load();
    return () => {
      aliveRef.current = false;
    };
  }, [load]);

  useSystemRealtimeRefresh(load, {
    tables: [
      "profiles",
      "course_access",
      "file_access_requests",
      "trade_submissions",
      "weekly_summaries",
      "student_documents",
      "ladder_authorizations",
      "notifications"
    ],
    throttleMs: 4000,
    globalThrottleMs: 4800,
    dedupeKey: "dashboard:summary"
  });

  const chart = React.useMemo(() => {
    if (!data || loading || error) return null;
    if (data.kind === "student") return data.hasCourseChart ? buildStudent3DOption(locale, data.items) : null;
    return buildAdmin3DOption(locale, data.students.byStatus);
  }, [data, error, loading, locale]);

  const isEmpty =
    !loading &&
    !error &&
    data &&
    (data.kind === "student" ? !data.hasCourseChart : data.students.total === 0);

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
        <div className="text-white/90 font-semibold text-xl">{locale === "zh" ? "仪表盘" : "Dashboard"}</div>
        <div className="mt-2 text-white/60 text-sm">
          {locale === "zh" ? "3D 数据概览（ECharts GL）。" : "3D overview (ECharts GL)."}
        </div>
      </div>

      {loading ? <div className="rounded-3xl border border-white/10 bg-white/5 p-6 text-white/60">{locale === "zh" ? "加载中…" : "Loading…"}</div> : null}
      {error ? <div className="rounded-3xl border border-rose-400/20 bg-rose-500/10 p-6 text-rose-100">{error}</div> : null}

      {!loading && !error && data ? (
        <>
          {data.kind === "student" && data.hasCourseChart ? (
            <div className="grid gap-4 md:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="text-xs text-white/50">{locale === "zh" ? "已完成" : "Completed"}</div>
                <div className="mt-2 text-3xl font-semibold text-white">
                  {data.counts.completed}/{data.totalCourses}
                </div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="text-xs text-white/50">{locale === "zh" ? "已授权" : "Approved"}</div>
                <div className="mt-2 text-3xl font-semibold text-white">{data.counts.approved}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="text-xs text-white/50">{locale === "zh" ? "待审批" : "Requested"}</div>
                <div className="mt-2 text-3xl font-semibold text-white">{data.counts.requested}</div>
              </div>
            </div>
          ) : data.kind === "admin" ? (
            <div className="grid gap-4 md:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="text-xs text-white/50">{locale === "zh" ? "学员数" : "Students"}</div>
                <div className="mt-2 text-3xl font-semibold text-white">{data.students.total}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="text-xs text-white/50">{locale === "zh" ? "冻结" : "Frozen"}</div>
                <div className="mt-2 text-3xl font-semibold text-white">{data.students.frozen}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="text-xs text-white/50">{locale === "zh" ? "文件待审批" : "File requests"}</div>
                <div className="mt-2 text-3xl font-semibold text-white">{data.pending.fileAccessRequests}</div>
              </div>
            </div>
          ) : null}

          {data.kind === "student" && data.showOnboardingGuide ? <StudentOnboardingGuideV2 locale={locale} /> : null}

          {data.kind === "admin" || data.hasCourseChart ? (
            <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
              <div className="text-white/85 font-semibold">
                {locale === "zh" ? "3D 图表" : "3D chart"}
              </div>
              {isEmpty ? (
                <div className="mt-3 text-white/60 text-sm">{locale === "zh" ? "暂无数据" : "No data"}</div>
              ) : (
                <div className="mt-4 h-[420px] w-full rounded-2xl border border-white/10 bg-white/5">
                  {chart ? <EChart option={chart as any} className="h-full w-full" /> : null}
                </div>
              )}
            </div>
          ) : null}

          {data.kind === "student" ? (
            <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
              <div className="text-white/85 font-semibold">{locale === "zh" ? "最近学习" : "Recent learning"}</div>
              <div className="mt-3 space-y-2">
                {data.latest.length ? (
                  data.latest.map((row) => (
                    <div key={row.course_id} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-3">
                      <div className="text-white/85 text-sm font-semibold">
                        {getCourseLabel(locale, row)}
                      </div>
                      <div className="text-white/50 text-xs">
                        <ClientDateTime
                          value={row.updated_at}
                          locale={locale === "zh" ? "zh-CN" : "en-US"}
                        />
                      </div>
                      <div className="ml-auto flex items-center gap-2">
                        <StatusBadge value={row.status} locale={locale} />
                        <span className="text-white/60 text-xs">{row.progress ?? 0}%</span>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-white/60 text-sm">
                    {locale === "zh" ? "暂无记录。去课程页申请并开始学习。" : "No activity yet. Request a course and start learning."}
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
