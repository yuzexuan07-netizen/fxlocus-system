"use client";

import React from "react";
import { useRouter } from "next/navigation";

import { StatusBadge } from "@/components/system/StatusBadge";
import { fetchSystemJson } from "@/lib/system/clientFetch";
import { getCourseRequestBlockMessage } from "@/lib/system/courseAccessRules";
import { getCourseDisplayCode, getCourseDisplayTitle } from "@/lib/system/courseDisplay";

export function CourseAccessGateClient({
  locale,
  courseId,
  courseTitleZh,
  courseTitleEn,
  status,
  rejectionReason,
  blocked,
  blockedReason
}: {
  locale: "zh" | "en";
  courseId: number;
  courseTitleZh?: string | null;
  courseTitleEn?: string | null;
  status: "none" | "requested" | "approved" | "rejected" | "completed";
  rejectionReason?: string | null;
  blocked?: boolean;
  blockedReason?: string | null;
}) {
  const router = useRouter();
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const canRequest = status === "none" || status === "rejected";
  const inFlightRef = React.useRef(false);
  const displayTitle = getCourseDisplayTitle(locale, {
    id: courseId,
    title_zh: courseTitleZh,
    title_en: courseTitleEn
  });
  const displayCode = getCourseDisplayCode(locale, courseId);

  const request = async () => {
    if (!canRequest || blocked) return;
    if (inFlightRef.current) return;

    inFlightRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const result = await fetchSystemJson("/api/system/courses/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ courseId }),
        dedupeKey: `course-request:${courseId}`,
        retries: 2,
        retryBaseMs: 260,
        retryMaxMs: 1500
      });

      if (result.ok) {
        router.refresh();
        return;
      }

      const code = result.errorCode || "REQUEST_FAILED";
      if (
        code === "PROFILE_SUBMISSION_REQUIRED" ||
        code === "COGNITIVE_COMPLETION_REQUIRED" ||
        code === "PREV_COMPLETION_AND_SUMMARY_REQUIRED" ||
        code === "PREV_COURSE_INCOMPLETE" ||
        code === "PREV_SUMMARY_REQUIRED"
      ) {
        setError(getCourseRequestBlockMessage(code, locale));
      } else if (code === "UNAUTHORIZED" || result.status === 401) {
        setError(locale === "zh" ? "\u767b\u5f55\u5df2\u5931\u6548\uff0c\u8bf7\u91cd\u65b0\u767b\u5f55\u3002" : "Session expired. Please sign in again.");
      } else if (code === "FORBIDDEN" || result.status === 403) {
        setError(
          locale === "zh" ? "\u5f53\u524d\u8d26\u53f7\u65e0\u6743\u9650\u7533\u8bf7\u8be5\u8bfe\u7a0b\u3002" : "You are not allowed to request this course."
        );
      } else {
        setError(locale === "zh" ? "\u7533\u8bf7\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5\u3002" : "Request failed. Please try again.");
      }
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-[900px]">
      <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
        <div className="flex items-center gap-2">
          <div>
            <div className="text-white/90 font-semibold text-xl">{displayTitle}</div>
            <div className="mt-1 text-xs text-white/45">{displayCode}</div>
          </div>
          <div className="ml-auto">{status === "none" ? null : <StatusBadge value={status} locale={locale} />}</div>
        </div>
        <div className="mt-3 text-white/60 text-sm leading-6">
          {status === "requested"
            ? locale === "zh"
              ? "\u5df2\u63d0\u4ea4\u7533\u8bf7\uff0c\u7b49\u5f85\u7ba1\u7406\u5458\u5ba1\u6279\u3002"
              : "Request submitted. Waiting for admin approval."
            : status === "rejected"
              ? locale === "zh"
                ? `\u7533\u8bf7\u88ab\u62d2\u7edd\uff1a${rejectionReason || "-"}`
                : `Rejected: ${rejectionReason || "-"}`
              : locale === "zh"
                ? "\u4f60\u5c1a\u672a\u83b7\u5f97\u8be5\u8bfe\u7a0b\u7684\u5b66\u4e60\u6743\u9650\u3002"
                : "You don't have access to this course yet."}
        </div>

        {blocked && blockedReason ? (
          <div className="mt-4 rounded-2xl border border-amber-200/20 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
            {blockedReason}
          </div>
        ) : null}

        {error ? (
          <div className="mt-4 rounded-2xl border border-rose-400/20 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">
            {error}
          </div>
        ) : null}

        <div className="mt-4 flex items-center gap-2">
          {canRequest ? (
            <button
              type="button"
              disabled={loading || blocked}
              onClick={request}
              className="px-4 py-2 rounded-xl bg-white/10 border border-white/20 text-white hover:bg-white/15 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (locale === "zh" ? "\u63d0\u4ea4\u4e2d..." : "Submitting...") : locale === "zh" ? "\u7533\u8bf7\u5b66\u4e60" : "Request access"}
            </button>
          ) : null}
          <a
            className="ml-auto px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-white/80 hover:bg-white/10"
            href={`/${locale}/system/courses`}
          >
            {locale === "zh" ? "\u8fd4\u56de\u8bfe\u7a0b\u5217\u8868" : "Back to courses"}
          </a>
        </div>
      </div>
    </div>
  );
}
